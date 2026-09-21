import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';

/**
 * Options for {@link createManagedInstancesService}.
 */
export interface ManagedInstancesServiceOptions {
  readonly cluster: ecs.Cluster;
  readonly taskDefinition: ecs.TaskDefinition;
  readonly capacityProvider: ecs.ManagedInstancesCapacityProvider;
  readonly subnets: ec2.ISubnet[];
  readonly securityGroups: ec2.ISecurityGroup[];
  readonly desiredCount: number;
  /** Load balancer target registrations (Mode B). @default none */
  readonly loadBalancers?: ecs.CfnService.LoadBalancerProperty[];
  /** Grace period before health checks count against the service (Mode B). */
  readonly healthCheckGracePeriodSeconds?: number;
}

/**
 * Builds the ECS service as an L1 `CfnService`.
 *
 * We drop to L1 deliberately: the L2 `Ec2Service`/`FargateService` force a
 * `launchType` and validate for ASG/Fargate capacity, neither of which fits a
 * Managed Instances capacity-provider strategy. `CfnService` lets us attach the
 * capacity provider directly while we keep L2 constructs everywhere else
 * (cluster, capacity provider, task definition, target group, autoscaling).
 */
export function createManagedInstancesService(
  scope: Construct,
  id: string,
  options: ManagedInstancesServiceOptions,
): ecs.CfnService {
  const service = new ecs.CfnService(scope, id, {
    cluster: options.cluster.clusterName,
    taskDefinition: options.taskDefinition.taskDefinitionArn,
    desiredCount: options.desiredCount,
    capacityProviderStrategy: [{ capacityProvider: options.capacityProvider.capacityProviderName, weight: 1 }],
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets: options.subnets.map((s) => s.subnetId),
        securityGroups: options.securityGroups.map((sg) => sg.securityGroupId),
        assignPublicIp: 'DISABLED',
      },
    },
    // Circuit breaker with rollback, matching the source sample.
    deploymentConfiguration: {
      maximumPercent: 200,
      minimumHealthyPercent: 100,
      deploymentCircuitBreaker: { enable: true, rollback: true },
    },
    loadBalancers: options.loadBalancers,
    healthCheckGracePeriodSeconds: options.healthCheckGracePeriodSeconds,
  });

  // The capacity-provider/cluster association must exist before the service.
  service.node.addDependency(options.capacityProvider);
  return service;
}

/**
 * Application Auto Scaling resource id for an ECS service's desired count:
 * `service/<clusterName>/<serviceName>`.
 */
export function serviceScalingResourceId(cluster: ecs.Cluster, service: ecs.CfnService): string {
  return `service/${cluster.clusterName}/${service.attrName}`;
}
