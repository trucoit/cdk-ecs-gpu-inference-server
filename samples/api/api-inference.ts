/**
 * API mode (Mode B), isolated: online, behind an Application Load Balancer.
 *
 * Copy this into your CDK app and adjust the imported resources. It creates NO
 * satellite resources. The VPC and subnets already exist and are passed in,
 * which is exactly how the library is meant to be consumed.
 *
 * Replace the vpc-/subnet identifiers below with your own.
 */
import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { ApiInferenceServer, InferenceContainer } from 'cdk-ecs-gpu-inference-server';

export class ApiInferenceExample extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // 1. Bring your own VPC and subnets. The library never creates a VPC.
    const vpc = ec2.Vpc.fromLookup(this, 'Vpc', { vpcId: 'vpc-0123456789abcdef0' });
    const vpcSubnets: ec2.SubnetSelection = {
      subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, // must reach ECR and AWS APIs
    };

    // 2. Create the API-mode inference server. The ALB is internal by default;
    //    pass loadBalancer: { internetFacing: true } for a public endpoint.
    const api = new ApiInferenceServer(this, 'Inference', {
      vpc,
      vpcSubnets,
      // A small, ungated model that fits the cheap default T4 GPU. --dtype half
      // because the T4 (compute capability 7.5) does not support bfloat16.
      model: InferenceContainer.vllm({
        image: ecs.ContainerImage.fromRegistry('vllm/vllm-openai:v0.6.6'),
        command: ['--model', 'Qwen/Qwen2.5-1.5B-Instruct', '--dtype', 'half', '--max-model-len', '8192'],
      }),
      scaling: { minCapacity: 1, maxCapacity: 4 },
    });

    // Clients POST to this endpoint at /v1/chat/completions.
    new CfnOutput(this, 'ApiUrl', { value: `http://${api.loadBalancer.loadBalancerDnsName}` });
  }
}
