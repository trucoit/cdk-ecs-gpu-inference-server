import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';

/**
 * Creates the ECS cluster with enhanced Container Insights, matching the
 * source sample. Capacity is attached separately (see `capacity-provider.ts`).
 */
export function createCluster(scope: Construct, id: string, vpc: ec2.IVpc, clusterName?: string): ecs.Cluster {
  return new ecs.Cluster(scope, id, {
    vpc,
    clusterName,
    containerInsightsV2: ecs.ContainerInsights.ENHANCED,
  });
}
