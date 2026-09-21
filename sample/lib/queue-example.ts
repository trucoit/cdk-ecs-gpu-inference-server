import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { QueueInferenceServer } from 'cdk-ecs-gpu-inference-server';
import { exampleVpc, vllmModel } from './common';

/**
 * Mode A, queue-driven, scale-to-zero. One task runs vLLM plus the construct's
 * built-in worker sidecar, which polls SQS, calls the model over localhost, and
 * writes results to S3.
 *
 * vLLM speaks the OpenAI protocol, so the built-in worker needs no configuration.
 * The worker image is built by the construct at deploy time (Docker required).
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

    const inference = new QueueInferenceServer(this, 'Inference', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      dataBucket,
      model: vllmModel(),
    });

    new CfnOutput(this, 'DataBucketName', { value: dataBucket.bucketName });
    new CfnOutput(this, 'JobQueueUrl', { value: inference.jobQueue.queueUrl });
  }
}
