import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { ApiInferenceServer, InferenceContainer, QueueInferenceServer, createInferenceDashboard } from '../lib';

describe('inference dashboard', () => {
  const app = new App();
  const stack = new Stack(app, 'Dash', { env: { account: '111111111111', region: 'us-east-1' } });
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

  const api = new ApiInferenceServer(stack, 'Api', {
    vpc,
    vpcSubnets,
    projectName: 'a',
    model: InferenceContainer.vllm({ image: ecs.ContainerImage.fromRegistry('example/model:latest') }),
    cluster: queue.cluster,
    capacityProvider: queue.capacityProvider,
  });

  createInferenceDashboard(stack, 'Dashboard', { services: [queue, api] });

  const template = Template.fromStack(stack);

  test('creates exactly one dashboard', () => {
    template.resourceCountIs('AWS::CloudWatch::Dashboard', 1);
  });

  test('charts queue, API, and compute metrics', () => {
    const dashboards = template.findResources('AWS::CloudWatch::Dashboard');
    const body = Object.values(dashboards)[0].Properties.DashboardBody;
    // DashboardBody is a Fn::Join of literals and tokens; assert on the literal parts.
    const text = JSON.stringify(body);
    expect(text).toContain('ApproximateNumberOfMessagesVisible'); // queue
    expect(text).toContain('TargetResponseTime'); // API
    expect(text).toContain('CPUUtilization'); // compute
    expect(text).toContain('RunningTaskCount'); // fleet
  });
});
