import { App, Stack } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { ApiInferenceServer, InferenceContainer } from '../lib';

function synth(): Template {
  const app = new App();
  const stack = new Stack(app, 'TestStack', { env: { account: '111111111111', region: 'us-east-1' } });
  const vpc = new ec2.Vpc(stack, 'Vpc');

  new ApiInferenceServer(stack, 'Inference', {
    vpc,
    vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    model: InferenceContainer.vllm({ image: ecs.ContainerImage.fromRegistry('example/vllm:latest') }),
    scaling: { minCapacity: 2, maxCapacity: 6 },
  });

  return Template.fromStack(stack);
}

describe('ApiInferenceServer (Mode B)', () => {
  const template = synth();

  test('fronts the model with an internal ALB + IP target group', () => {
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', { Scheme: 'internal' });
    template.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
      TargetType: 'ip',
      HealthCheckPath: '/health',
      Port: 8000,
    });
  });

  test('service registers the model container with the target group at min capacity', () => {
    template.hasResourceProperties('AWS::ECS::Service', {
      DesiredCount: 2,
      LoadBalancers: Match.arrayWith([Match.objectLike({ ContainerName: 'model', ContainerPort: 8000 })]),
    });
  });

  test('uses request-count target-tracking scaling, min >= 1', () => {
    template.hasResourceProperties('AWS::ApplicationAutoScaling::ScalableTarget', {
      MinCapacity: 2,
      MaxCapacity: 6,
    });
    template.hasResourceProperties('AWS::ApplicationAutoScaling::ScalingPolicy', {
      PolicyType: 'TargetTrackingScaling',
      TargetTrackingScalingPolicyConfiguration: Match.objectLike({
        PredefinedMetricSpecification: Match.objectLike({ PredefinedMetricType: 'ALBRequestCountPerTarget' }),
      }),
    });
  });

  test('has no worker container and no SQS queues', () => {
    template.resourceCountIs('AWS::SQS::Queue', 0);
    const tds = template.findResources('AWS::ECS::TaskDefinition');
    for (const td of Object.values(tds)) {
      const names = (td.Properties.ContainerDefinitions as { Name: string }[]).map((c) => c.Name);
      expect(names).toEqual(['model']);
    }
  });
});
