import { Annotations, Match } from 'aws-cdk-lib/assertions';
import { App, Aspects, Stack } from 'aws-cdk-lib';
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { ApiInferenceServer, InferenceContainer, QueueInferenceServer } from '../lib';

function nagErrors(stack: Stack): string[] {
  Aspects.of(stack).add(new AwsSolutionsChecks({ verbose: true }));
  const errors = Annotations.fromStack(stack).findError('*', Match.stringLikeRegexp('AwsSolutions-.*'));
  return errors.map((e) => JSON.stringify(e.entry.data));
}

describe('cdk-nag AwsSolutions', () => {
  test('QueueInferenceServer (Mode A) has no unsuppressed findings', () => {
    const app = new App();
    const stack = new Stack(app, 'NagQueue', { env: { account: '111111111111', region: 'us-east-1' } });
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
      workerImage: ecs.ContainerImage.fromRegistry('example/worker:latest'),
    });
    applySuppressions(stack);
    expect(nagErrors(stack)).toStrictEqual([]);
  });

  test('ApiInferenceServer (Mode B) has no unsuppressed findings', () => {
    const app = new App();
    const stack = new Stack(app, 'NagApi', { env: { account: '111111111111', region: 'us-east-1' } });
    const vpc = new ec2.Vpc(stack, 'Vpc');
    new ApiInferenceServer(stack, 'Inference', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      model: InferenceContainer.vllm({ image: ecs.ContainerImage.fromRegistry('example/vllm:latest') }),
    });
    applySuppressions(stack);
    expect(nagErrors(stack)).toStrictEqual([]);
  });
});

/**
 * Documented, by-design suppressions. Applied at the stack level so both the
 * construct and the test scaffolding (VPC, bucket) are covered.
 */
function applySuppressions(stack: Stack): void {
  NagSuppressions.addStackSuppressions(stack, [
    {
      id: 'AwsSolutions-IAM4',
      reason:
        'ECS Managed Instances relies on the AWS-managed infrastructure/instance policies, and the task execution role uses AmazonECSTaskExecutionRolePolicy, per AWS guidance.',
    },
    {
      id: 'AwsSolutions-IAM5',
      reason:
        'Task role permissions are scoped to the job queue and to S3 object-key prefixes (async-input/*, async-output/*); the object-key wildcard is required and intended.',
    },
    {
      id: 'AwsSolutions-ECS2',
      reason:
        'Environment variables here are non-secret wiring (queue URLs, bucket name, localhost endpoints), not credentials.',
    },
    {
      id: 'AwsSolutions-SQS3',
      reason: 'The dead-letter queue is itself a DLQ and does not require a further redrive target.',
    },
    {
      id: 'AwsSolutions-ELB2',
      reason: 'Example/library scope: ALB access logging is left to the consumer to point at their own log bucket.',
    },
    {
      id: 'AwsSolutions-EC23',
      reason:
        'The ALB is internal by default and its ingress is intentionally reachable within the VPC for the inference API.',
    },
    // The following apply only to consumer-provided satellite resources that this
    // library never creates (VPC, data bucket); securing them is the consumer's
    // responsibility. They appear here because the test scaffolding provides them.
    {
      id: 'AwsSolutions-VPC7',
      reason: "VPC is consumer-provided; enabling VPC flow logs is the consumer's responsibility.",
    },
    {
      id: 'AwsSolutions-S1',
      reason: 'The data bucket is consumer-provided; server access logging is configured by the consumer.',
    },
    {
      id: 'AwsSolutions-S10',
      reason: 'The data bucket is consumer-provided; the example omits enforceSSL, which real consumers set.',
    },
  ]);
}
