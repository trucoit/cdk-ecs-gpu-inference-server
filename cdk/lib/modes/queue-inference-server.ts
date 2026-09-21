import { Construct } from 'constructs';
import { Duration, Stack } from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { GpuInferenceBase } from '../base/gpu-inference-base';
import { GpuInferenceBaseProps, QueueOptions, QueueScalingOptions, WorkerOptions } from '../types';
import { createJobQueues } from '../messaging/queues';
import { createQueueScaling, QueueScaling } from '../scaling/queue-scaling';
import { serviceScalingResourceId } from '../compute/service';

/**
 * Props for {@link QueueInferenceServer} (Mode A — async, scale-to-zero).
 */
export interface QueueInferenceServerProps extends GpuInferenceBaseProps {
  /**
   * The bucket for job input/output payloads. **Consumer-provided** — the
   * construct only grants the task scoped access to the prefixes below.
   */
  readonly dataBucket: s3.IBucket;

  /**
   * The worker (SQS poller) container image. Consumer-provided.
   */
  readonly workerImage: ecs.ContainerImage;

  /** Worker sidecar overrides. */
  readonly worker?: WorkerOptions;

  /** SQS job/dead-letter queue tuning. */
  readonly queue?: QueueOptions;

  /** Scale-to-zero step-scaling tuning. */
  readonly scaling?: QueueScalingOptions;

  /** S3 key prefix for job inputs. @default 'async-input/' */
  readonly inputPrefix?: string;

  /** S3 key prefix for job outputs. @default 'async-output/' */
  readonly outputPrefix?: string;
}

/** The logical name of the worker sidecar container. */
export const WORKER_CONTAINER_NAME = 'worker';

/**
 * **Mode A — Queue.** A queue-driven, scale-to-zero GPU inference service.
 *
 * A single ECS task runs the model container plus a worker sidecar that polls
 * SQS and calls the model over `localhost`. The service sits at desired count 0
 * and is scaled 0<->1 by SQS-depth alarms. Faithful to the `aws-samples`
 * `sample-ecs-gpu-inference` architecture.
 */
export class QueueInferenceServer extends GpuInferenceBase {
  /** The SQS job queue (scaling watches its depth). */
  public readonly jobQueue: sqs.Queue;
  /** The dead-letter queue for poison messages. */
  public readonly deadLetterQueue: sqs.Queue;
  /** The worker sidecar container. */
  public readonly workerContainer: ecs.ContainerDefinition;
  /** The ECS service (desired count 0). */
  public readonly service: ecs.CfnService;
  /** The autoscaling target + alarms. */
  public readonly scaling: QueueScaling;

  constructor(scope: Construct, id: string, props: QueueInferenceServerProps) {
    super(scope, id, props);

    const region = Stack.of(this).region;
    const inputPrefix = props.inputPrefix ?? 'async-input/';
    const outputPrefix = props.outputPrefix ?? 'async-output/';

    const { jobQueue, deadLetterQueue } = createJobQueues(this, 'JobQueue', props.queue);
    this.jobQueue = jobQueue;
    this.deadLetterQueue = deadLetterQueue;

    // Worker sidecar: polls SQS and calls the model over localhost.
    const workerLogGroup = new logs.LogGroup(this, 'WorkerLogs', {
      logGroupName: `/ecs/${this.projectName}/${WORKER_CONTAINER_NAME}`,
      retention: this.logRetention,
    });

    const modelPort = props.model.containerPort;
    const healthPath = props.model.healthCheckPath ?? '/health';

    this.workerContainer = this.taskDefinition.addContainer(WORKER_CONTAINER_NAME, {
      image: props.workerImage,
      cpu: props.worker?.cpu ?? 512,
      memoryLimitMiB: props.worker?.memoryLimitMiB ?? 1024,
      essential: true,
      stopTimeout: Duration.seconds(props.worker?.stopTimeoutSeconds ?? 120),
      logging: ecs.LogDrivers.awsLogs({ logGroup: workerLogGroup, streamPrefix: WORKER_CONTAINER_NAME }),
      environment: {
        // Injected wiring; consumer `worker.environment` overrides take precedence.
        QUEUE_URL: jobQueue.queueUrl,
        DLQ_URL: deadLetterQueue.queueUrl,
        S3_BUCKET: props.dataBucket.bucketName,
        AWS_DEFAULT_REGION: region,
        MODEL_ENDPOINT: `http://localhost:${modelPort}`,
        HEALTH_ENDPOINT: `http://localhost:${modelPort}${healthPath}`,
        ...props.worker?.environment,
      },
    });

    // Start the worker only once the model reports healthy.
    this.workerContainer.addContainerDependencies({
      container: this.modelContainer,
      condition: ecs.ContainerDependencyCondition.HEALTHY,
    });

    this.grantTaskPermissions(props.dataBucket, inputPrefix, outputPrefix);

    this.service = this.createService('Service', { desiredCount: 0 });

    this.scaling = createQueueScaling(this, 'Scaling', {
      resourceId: serviceScalingResourceId(this.cluster, this.service),
      jobQueue: this.jobQueue,
      options: props.scaling,
    });
    this.scaling.scalableTarget.node.addDependency(this.service);
  }

  /** Grants the task role scoped SQS + S3-prefix access, matching the source IAM. */
  private grantTaskPermissions(dataBucket: s3.IBucket, inputPrefix: string, outputPrefix: string): void {
    const taskRole = this.taskDefinition.taskRole;

    this.jobQueue.grantConsumeMessages(taskRole);
    this.deadLetterQueue.grantSendMessages(taskRole);

    taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject', 's3:DeleteObject'],
        resources: [dataBucket.arnForObjects(`${inputPrefix}*`)],
      }),
    );
    taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['s3:PutObject'],
        resources: [dataBucket.arnForObjects(`${outputPrefix}*`)],
      }),
    );
  }
}
