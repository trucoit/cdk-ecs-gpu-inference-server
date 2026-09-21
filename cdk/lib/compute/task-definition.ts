import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { InferenceContainerProps, INFERENCE_CONTAINER_DEFAULTS } from '../inference-container';

/** The logical name of the model container within the task. */
export const MODEL_CONTAINER_NAME = 'model';

/**
 * Creates a Managed-Instances-compatible, `awsvpc` task definition. Container
 * resources are reserved at the container level (as in the source sample), so
 * no task-level CPU/memory is set.
 */
export function createTaskDefinition(scope: Construct, id: string): ecs.TaskDefinition {
  return new ecs.TaskDefinition(scope, id, {
    compatibility: ecs.Compatibility.MANAGED_INSTANCES,
    networkMode: ecs.NetworkMode.AWS_VPC,
  });
}

/**
 * Adds the model-server container to a task definition, reserving GPUs and
 * wiring an HTTP health check against the server's health path.
 */
export function addModelContainer(
  taskDefinition: ecs.TaskDefinition,
  model: InferenceContainerProps,
  logGroup: logs.ILogGroup,
): ecs.ContainerDefinition {
  const port = model.containerPort;
  const healthPath = model.healthCheckPath ?? INFERENCE_CONTAINER_DEFAULTS.healthCheckPath;
  const healthCheckCommand = model.healthCheckCommand ?? [
    'CMD-SHELL',
    `curl -f http://localhost:${port}${healthPath} || exit 1`,
  ];
  const startPeriod = model.healthCheckStartPeriodSeconds ?? INFERENCE_CONTAINER_DEFAULTS.healthCheckStartPeriodSeconds;

  const container = taskDefinition.addContainer(MODEL_CONTAINER_NAME, {
    image: model.image,
    gpuCount: model.gpuCount ?? INFERENCE_CONTAINER_DEFAULTS.gpuCount,
    memoryLimitMiB: model.memoryLimitMiB ?? INFERENCE_CONTAINER_DEFAULTS.memoryLimitMiB,
    cpu: model.cpu ?? INFERENCE_CONTAINER_DEFAULTS.cpu,
    essential: true,
    command: model.command,
    environment: model.environment,
    logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: MODEL_CONTAINER_NAME }),
    healthCheck: {
      command: healthCheckCommand,
      interval: Duration.seconds(30),
      timeout: Duration.seconds(5),
      retries: 10,
      startPeriod: Duration.seconds(startPeriod),
    },
    // vLLM/Triton and friends benefit from unlimited locked memory for pinned buffers.
    ulimits: [{ name: ecs.UlimitName.MEMLOCK, softLimit: -1, hardLimit: -1 }],
  });

  container.addPortMappings({ containerPort: port, name: MODEL_CONTAINER_NAME });
  return container;
}
