import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';

/**
 * Creates the ECS cluster with enhanced Container Insights. The cluster name is
 * left unset so CloudFormation assigns a unique one (avoids collisions when
 * several instances run in the same account). Capacity is attached separately
 * (see `capacity-provider.ts`).
 */
export function createCluster(scope: Construct, id: string, vpc: ec2.IVpc): ecs.Cluster {
  return new ecs.Cluster(scope, id, {
    vpc,
    containerInsightsV2: ecs.ContainerInsights.ENHANCED,
  });
}
