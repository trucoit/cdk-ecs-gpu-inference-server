import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { ApiInferenceServer, QueueInferenceServer } from 'cdk-ecs-gpu-inference-server';
import { exampleVpc, vllmModel } from './common';

/**
 * One stack, one VPC, one ECS cluster. Both inference modes run as separate
 * services sharing that cluster and its GPU capacity provider:
 *
 * - Queue mode: async, scale-to-zero, driven by SQS. Creates the cluster and the
 *   capacity provider.
 * - API mode: online, behind an ALB. Reuses the queue's cluster and provider, so
 *   no second VPC/cluster is created.
 *
 * Both serve the same vLLM model. The API's ALB is internet-facing so it is
 * curl-testable (fine for a demo, not for production).
 */
export class SampleStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const vpc = exampleVpc(this);
    const vpcSubnets: ec2.SubnetSelection = { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS };

    const dataBucket = new s3.Bucket(this, 'DataBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [
        { prefix: 'async-output/', expiration: Duration.days(7) },
        { prefix: 'async-input/', expiration: Duration.days(30) },
      ],
    });

    // Queue service creates the shared cluster + GPU capacity provider.
    const queue = new QueueInferenceServer(this, 'Queue', {
      vpc,
      vpcSubnets,
      dataBucket,
      projectName: 'gpu-inference-queue',
      model: vllmModel(),
    });

    // API service reuses the queue's cluster + provider (no new VPC/cluster).
    const api = new ApiInferenceServer(this, 'Api', {
      vpc,
      vpcSubnets,
      projectName: 'gpu-inference-api',
      model: vllmModel(),
      cluster: queue.cluster,
      capacityProvider: queue.capacityProvider,
      loadBalancer: { internetFacing: true },
      scaling: { minCapacity: 1, maxCapacity: 4 },
    });

    new CfnOutput(this, 'DataBucketName', { value: dataBucket.bucketName });
    new CfnOutput(this, 'JobQueueUrl', { value: queue.jobQueue.queueUrl });
    new CfnOutput(this, 'ApiUrl', { value: `http://${api.loadBalancer.loadBalancerDnsName}` });
  }
}
