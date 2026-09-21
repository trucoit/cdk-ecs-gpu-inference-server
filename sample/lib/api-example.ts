import { CfnOutput, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { ApiInferenceServer } from 'cdk-ecs-gpu-inference-server';
import { exampleVpc, vllmModel } from './common';

/**
 * Mode B, online API. vLLM sits behind an ALB and serves an OpenAI-compatible
 * endpoint (POST /v1/chat/completions).
 *
 * The ALB is internet-facing so the sample is curl-testable. That exposes an
 * open inference endpoint, which is fine for a throwaway demo but not for
 * production. Keep it internal (drop `internetFacing`) and reach it from inside
 * the VPC for anything real.
 */
export class ApiExampleStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    const vpc = exampleVpc(this);

    const inference = new ApiInferenceServer(this, 'Inference', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      model: vllmModel(),
      loadBalancer: { internetFacing: true },
      scaling: { minCapacity: 1, maxCapacity: 4 },
    });

    new CfnOutput(this, 'ApiUrl', { value: `http://${inference.loadBalancer.loadBalancerDnsName}` });
  }
}
