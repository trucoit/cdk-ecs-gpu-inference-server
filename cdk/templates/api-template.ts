import { CfnParameter, DefaultStackSynthesizer, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { ApiInferenceServer } from '../lib';
import { vllmModel } from './model';
import { importVpc } from './queue-template';

/**
 * Standalone CloudFormation template for the API (online) mode.
 *
 * Deployable without CDK: networking and the model image are CloudFormation
 * parameters. It creates the ECS cluster, GPU capacity provider, task/service,
 * an internal ALB, and autoscaling. The ALB is internal (it uses the provided
 * subnets); front it yourself for public access.
 */
export class ApiTemplateStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, {
      ...props,
      synthesizer: new DefaultStackSynthesizer({ generateBootstrapVersionRule: false }),
      analyticsReporting: false,
      description: 'GPU inference (API mode): vLLM behind an internal ALB on ECS Managed Instances.',
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
    const modelId = new CfnParameter(this, 'ModelId', {
      type: 'String',
      default: 'Qwen/Qwen2.5-1.5B-Instruct',
      description: 'Model the vLLM server loads.',
    });
    const modelImage = new CfnParameter(this, 'ModelImage', {
      type: 'String',
      default: 'vllm/vllm-openai:v0.6.6',
      description: 'OpenAI-compatible model server image.',
    });

    const { vpc, subnets } = importVpc(this, vpcId, [subnet1, subnet2]);

    new ApiInferenceServer(this, 'Inference', {
      vpc,
      vpcSubnets: { subnets },
      model: vllmModel(ecs.ContainerImage.fromRegistry(modelImage.valueAsString), modelId.valueAsString),
      // Internal ALB: an internet-facing one would need public subnets, which an
      // imported (parameterized) VPC does not expose.
      loadBalancer: { internetFacing: false },
      scaling: { minCapacity: 1, maxCapacity: 4 },
    });
  }
}
