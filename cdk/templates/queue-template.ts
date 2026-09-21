import { CfnParameter, DefaultStackSynthesizer, Fn, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { QueueInferenceServer } from '../lib';
import { vllmModel } from './model';

/**
 * Standalone CloudFormation template for the queue (async, scale-to-zero) mode.
 *
 * Deployable without CDK: networking, the data bucket, and the container images
 * are CloudFormation parameters. It creates the ECS cluster, GPU capacity
 * provider, task/service, SQS queues, IAM, and log groups.
 */
export class QueueTemplateStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, {
      ...props,
      // Emit a plain template with no CDK bootstrap parameters or metadata.
      synthesizer: new DefaultStackSynthesizer({ generateBootstrapVersionRule: false }),
      analyticsReporting: false,
      description: 'GPU inference (queue mode): SQS-driven, scale-to-zero ECS Managed Instances service.',
    });

    const vpcId = new CfnParameter(this, 'VpcId', { type: 'AWS::EC2::VPC::Id', description: 'VPC to deploy into.' });
    const subnet1 = new CfnParameter(this, 'PrivateSubnetId1', {
      type: 'AWS::EC2::Subnet::Id',
      description: 'First private subnet (needs egress to pull images and reach AWS APIs).',
    });
    const subnet2 = new CfnParameter(this, 'PrivateSubnetId2', {
      type: 'AWS::EC2::Subnet::Id',
      description: 'Second private subnet (different AZ).',
    });
    const bucketName = new CfnParameter(this, 'DataBucketName', {
      type: 'String',
      description: 'Existing S3 bucket for job input (async-input/) and output (async-output/).',
    });
    const modelId = new CfnParameter(this, 'ModelId', {
      type: 'String',
      default: 'Qwen/Qwen2.5-1.5B-Instruct',
      description: 'Model the vLLM server loads and the worker requests.',
    });
    const modelImage = new CfnParameter(this, 'ModelImage', {
      type: 'String',
      default: 'vllm/vllm-openai:v0.6.6',
      description: 'OpenAI-compatible model server image.',
    });
    const workerImage = new CfnParameter(this, 'WorkerImage', {
      type: 'String',
      description: 'SQS worker image URI (an OpenAI-protocol poller). Build and push it, then set it here.',
    });

    const { vpc, subnets } = importVpc(this, vpcId, [subnet1, subnet2]);

    new QueueInferenceServer(this, 'Inference', {
      vpc,
      vpcSubnets: { subnets },
      dataBucket: s3.Bucket.fromBucketName(this, 'DataBucket', bucketName.valueAsString),
      model: vllmModel(ecs.ContainerImage.fromRegistry(modelImage.valueAsString), modelId.valueAsString),
      workerImage: ecs.ContainerImage.fromRegistry(workerImage.valueAsString),
      worker: { modelId: modelId.valueAsString },
    });
  }
}

/** Imports a VPC and an explicit subnet list from CloudFormation parameters. */
export function importVpc(
  scope: Construct,
  vpcId: CfnParameter,
  subnetParams: CfnParameter[],
): { vpc: ec2.IVpc; subnets: ec2.ISubnet[] } {
  const subnetIds = subnetParams.map((p) => p.valueAsString);
  const vpc = ec2.Vpc.fromVpcAttributes(scope, 'Vpc', {
    vpcId: vpcId.valueAsString,
    availabilityZones: Fn.getAzs(),
    privateSubnetIds: subnetIds,
  });
  const subnets = subnetParams.map((p, i) => ec2.Subnet.fromSubnetId(scope, `Subnet${i + 1}`, p.valueAsString));
  return { vpc, subnets };
}
