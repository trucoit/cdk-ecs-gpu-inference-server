import { App, Stack } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { InferenceContainer, QueueInferenceServer } from '../lib';

function synth(): Template {
  const app = new App();
  const stack = new Stack(app, 'TestStack', { env: { account: '111111111111', region: 'us-east-1' } });
  const vpc = new ec2.Vpc(stack, 'Vpc');
  const bucket = new s3.Bucket(stack, 'Bucket');

  new QueueInferenceServer(stack, 'Inference', {
    vpc,
    vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    dataBucket: bucket,
    model: InferenceContainer.custom({
      image: ecs.ContainerImage.fromRegistry('example/model:latest'),
      containerPort: 8091,
    }),
    // No workerImage: exercise the library's built-in worker asset.
  });

  return Template.fromStack(stack);
}

describe('QueueInferenceServer (Mode A)', () => {
  const template = synth();

  test('creates a Managed Instances GPU capacity provider', () => {
    template.hasResourceProperties('AWS::ECS::CapacityProvider', {
      ManagedInstancesProvider: Match.objectLike({
        InstanceLaunchTemplate: Match.objectLike({
          InstanceRequirements: Match.objectLike({
            AcceleratorTypes: ['gpu'],
            AcceleratorManufacturers: ['nvidia'],
          }),
        }),
      }),
    });
  });

  test('task definition has both model and worker containers, model reserves a GPU', () => {
    template.hasResourceProperties('AWS::ECS::TaskDefinition', {
      RequiresCompatibilities: Match.arrayWith(['MANAGED_INSTANCES']),
      NetworkMode: 'awsvpc',
      ContainerDefinitions: Match.arrayWith([
        Match.objectLike({
          Name: 'model',
          ResourceRequirements: Match.arrayWith([Match.objectLike({ Type: 'GPU', Value: '1' })]),
        }),
        Match.objectLike({ Name: 'worker' }),
      ]),
    });
  });

  test('service runs at desired count 0 on the capacity provider, no load balancer', () => {
    template.hasResourceProperties('AWS::ECS::Service', {
      DesiredCount: 0,
      CapacityProviderStrategy: Match.arrayWith([Match.objectLike({ Weight: 1 })]),
    });
    const svc = template.findResources('AWS::ECS::Service');
    for (const s of Object.values(svc)) {
      expect(s.Properties.LoadBalancers ?? []).toHaveLength(0);
    }
    template.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 0);
  });

  test('creates the SQS job queue + DLQ and scale-out/scale-in alarms', () => {
    template.resourceCountIs('AWS::SQS::Queue', 2);
    template.resourceCountIs('AWS::CloudWatch::Alarm', 2);
    template.hasResourceProperties('AWS::ApplicationAutoScaling::ScalableTarget', {
      MinCapacity: 0,
      MaxCapacity: 1,
      ScalableDimension: 'ecs:service:DesiredCount',
    });
  });

  test('does not create a VPC or S3 bucket of its own (consumer-provided)', () => {
    // Only the single test VPC + bucket exist; the construct adds none.
    template.resourceCountIs('AWS::EC2::VPC', 1);
    template.resourceCountIs('AWS::S3::Bucket', 1);
  });
});
