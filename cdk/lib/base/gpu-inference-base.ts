import { Construct } from 'constructs';
import { RemovalPolicy } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { GpuInferenceBaseProps } from '../types';
import { createEgressSecurityGroup } from '../network/security-group';
import { createCluster } from '../compute/cluster';
import { createGpuCapacityProvider } from '../compute/capacity-provider';
import { addModelContainer, createTaskDefinition } from '../compute/task-definition';
import { createManagedInstancesService } from '../compute/service';

/**
 * Options a mode subclass passes to {@link GpuInferenceBase.createService}.
 */
export interface BaseServiceOptions {
  readonly desiredCount: number;
  readonly loadBalancers?: ecs.CfnService.LoadBalancerProperty[];
  readonly healthCheckGracePeriodSeconds?: number;
}

/**
 * Shared GPU-on-ECS core for both deployment modes.
 *
 * Builds the cluster, the Managed Instances GPU capacity provider, the security
 * groups, the model log group, and the task definition (with the model
 * container). Subclasses add their mode-specific front-end (worker + SQS, or
 * ALB) and call {@link createService}.
 */
export abstract class GpuInferenceBase extends Construct {
  /** The ECS cluster. */
  public readonly cluster: ecs.Cluster;
  /** The Managed Instances GPU capacity provider. */
  public readonly capacityProvider: ecs.ManagedInstancesCapacityProvider;
  /** The shared task definition (model container; worker added in Mode A). */
  public readonly taskDefinition: ecs.TaskDefinition;
  /** The model-server container definition. */
  public readonly modelContainer: ecs.ContainerDefinition;
  /** Security group on the task ENIs. */
  public readonly taskSecurityGroup: ec2.SecurityGroup;
  /** Security group on the GPU instances. Set only when this construct creates the capacity provider. */
  public readonly instanceSecurityGroup?: ec2.SecurityGroup;
  /** CloudWatch log group for the model container. */
  public readonly modelLogGroup: logs.LogGroup;

  protected readonly baseProps: GpuInferenceBaseProps;
  protected readonly projectName: string;
  protected readonly subnets: ec2.ISubnet[];
  protected readonly logRetention: logs.RetentionDays;

  protected constructor(scope: Construct, id: string, props: GpuInferenceBaseProps) {
    super(scope, id);

    this.baseProps = props;
    this.projectName = props.projectName ?? 'gpu-inference';
    this.logRetention = (props.logRetentionDays ?? 14) as logs.RetentionDays;
    this.subnets = props.vpc.selectSubnets(props.vpcSubnets).subnets;

    this.taskSecurityGroup = createEgressSecurityGroup(this, 'TaskSecurityGroup', props.vpc, 'GPU inference task ENIs');

    // Reuse a shared cluster/capacity provider when given, so several services
    // can live in one cluster. Otherwise create them here.
    this.cluster = props.cluster ?? createCluster(this, 'Cluster', props.vpc);
    if (props.capacityProvider) {
      this.capacityProvider = props.capacityProvider;
    } else {
      this.instanceSecurityGroup = createEgressSecurityGroup(
        this,
        'InstanceSecurityGroup',
        props.vpc,
        'GPU inference instances',
      );
      this.capacityProvider = createGpuCapacityProvider(
        this,
        'GpuCapacity',
        this.cluster,
        this.subnets,
        [this.instanceSecurityGroup],
        props.gpuInstanceRequirements,
      );
    }

    this.modelLogGroup = new logs.LogGroup(this, 'ModelLogs', {
      logGroupName: `/ecs/${this.projectName}/model`,
      retention: this.logRetention,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.taskDefinition = createTaskDefinition(this, 'TaskDef');
    this.modelContainer = addModelContainer(this.taskDefinition, props.model, this.modelLogGroup);
  }

  /** Creates the ECS service on the GPU capacity provider (see subclasses). */
  protected createService(id: string, options: BaseServiceOptions): ecs.CfnService {
    return createManagedInstancesService(this, id, {
      cluster: this.cluster,
      taskDefinition: this.taskDefinition,
      capacityProvider: this.capacityProvider,
      subnets: this.subnets,
      securityGroups: [this.taskSecurityGroup],
      desiredCount: options.desiredCount,
      loadBalancers: options.loadBalancers,
      healthCheckGracePeriodSeconds: options.healthCheckGracePeriodSeconds,
    });
  }
}
