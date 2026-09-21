import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { ApiInferenceServer, InferenceContainer } from '../lib';
import { exampleVpc } from './common';

/**
 * Mode B — online API fronted by an ALB. Generic across inference servers;
 * here it uses the vLLM preset. Replace the placeholder image with your own.
 */
export class ApiExampleStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    const vpc = exampleVpc(this);

    new ApiInferenceServer(this, 'Inference', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      model: InferenceContainer.vllm({
        image: ecs.ContainerImage.fromRegistry('public.ecr.aws/amazonlinux/amazonlinux:latest'),
      }),
      scaling: { minCapacity: 1, maxCapacity: 4 },
    });
  }
}
