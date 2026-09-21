import { Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { InferenceContainer, QueueInferenceServer } from 'cdk-ecs-gpu-inference-server';
import { exampleVpc } from './common';

/**
 * Mode A, queue-driven, scale-to-zero (the sample's original shape).
 *
 * The stack creates the satellite resources a consumer owns (VPC, S3 data
 * bucket) and hands them to the construct. Replace the placeholder images with
 * your own ECR images before deploying a real workload.
 */
export class QueueExampleStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    const vpc = exampleVpc(this);

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

    new QueueInferenceServer(this, 'Inference', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      dataBucket,
      // Replace with your own ECR images.
      model: InferenceContainer.custom({
        image: ecs.ContainerImage.fromRegistry('public.ecr.aws/amazonlinux/amazonlinux:latest'),
        containerPort: 8091,
      }),
      workerImage: ecs.ContainerImage.fromRegistry('public.ecr.aws/amazonlinux/amazonlinux:latest'),
    });
  }
}
