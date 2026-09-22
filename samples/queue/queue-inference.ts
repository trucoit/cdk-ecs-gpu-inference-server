/**
 * Queue mode (Mode A), isolated: async, scale-to-zero, SQS-driven.
 *
 * Copy this into your CDK app and adjust the imported resources. It creates NO
 * satellite resources. The VPC, subnets, and S3 data bucket already exist and
 * are passed in, which is exactly how the library is meant to be consumed.
 *
 * Replace the vpc-/subnet-/bucket identifiers below with your own.
 */
import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { QueueInferenceServer, InferenceContainer } from 'cdk-ecs-gpu-inference-server';

export class QueueInferenceExample extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // 1. Bring your own VPC and subnets. The library never creates a VPC.
    const vpc = ec2.Vpc.fromLookup(this, 'Vpc', { vpcId: 'vpc-0123456789abcdef0' });
    const vpcSubnets: ec2.SubnetSelection = {
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, // must reach ECR and AWS APIs
    };

    // 2. Bring your own S3 bucket for job input (async-input/) and output (async-output/).
    const dataBucket = s3.Bucket.fromBucketName(this, 'DataBucket', 'my-existing-inference-bucket');

    // 3. Create the queue-mode inference server.
    const queue = new QueueInferenceServer(this, 'Inference', {
      vpc,
      vpcSubnets,
      dataBucket,
      // A small, ungated model that fits the cheap default T4 GPU. --dtype half
      // because the T4 (compute capability 7.5) does not support bfloat16.
      model: InferenceContainer.vllm({
        image: ecs.ContainerImage.fromRegistry('vllm/vllm-openai:v0.6.6'),
        command: ['--model', 'Qwen/Qwen2.5-1.5B-Instruct', '--dtype', 'half', '--max-model-len', '8192'],
      }),
      // No worker image needed: the built-in worker speaks the OpenAI protocol.
    });

    new CfnOutput(this, 'JobQueueUrl', { value: queue.jobQueue.queueUrl });
    new CfnOutput(this, 'DataBucketName', { value: dataBucket.bucketName });
  }
}
