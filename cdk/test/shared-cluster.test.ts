import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { ApiInferenceServer, InferenceContainer, QueueInferenceServer } from '../lib';

describe('shared cluster (two services, one cluster)', () => {
  const app = new App();
  const stack = new Stack(app, 'Shared', { env: { account: '111111111111', region: 'us-east-1' } });
  const vpc = new ec2.Vpc(stack, 'Vpc');
  const bucket = new s3.Bucket(stack, 'Bucket');
  const vpcSubnets = { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS };

  const queue = new QueueInferenceServer(stack, 'Queue', {
    vpc,
    vpcSubnets,
    dataBucket: bucket,
    projectName: 'q',
    model: InferenceContainer.vllm({ image: ecs.ContainerImage.fromRegistry('example/model:latest') }),
  });

  new ApiInferenceServer(stack, 'Api', {
    vpc,
    vpcSubnets,
    projectName: 'a',
    model: InferenceContainer.vllm({ image: ecs.ContainerImage.fromRegistry('example/model:latest') }),
    cluster: queue.cluster,
    capacityProvider: queue.capacityProvider,
  });

  const template = Template.fromStack(stack);

  test('only one cluster and one capacity provider are created', () => {
    template.resourceCountIs('AWS::ECS::Cluster', 1);
    template.resourceCountIs('AWS::ECS::CapacityProvider', 1);
  });

  test('both services are created', () => {
    template.resourceCountIs('AWS::ECS::Service', 2);
  });
});
