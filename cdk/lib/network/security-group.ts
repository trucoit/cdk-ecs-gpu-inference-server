import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

/**
 * Creates an egress-only security group for GPU workloads.
 *
 * Mirrors the source sample's `TaskSecurityGroup`: no ingress, egress to
 * `0.0.0.0/0` on TCP 443 so the task can reach ECR, S3, SQS and other AWS
 * endpoints. Mode B additionally opens ingress from the ALB (added by the ALB
 * module), so this SG is `allowAllOutbound: false` with an explicit 443 rule.
 */
export function createEgressSecurityGroup(
  scope: Construct,
  id: string,
  vpc: ec2.IVpc,
  description: string,
): ec2.SecurityGroup {
  const sg = new ec2.SecurityGroup(scope, id, {
    vpc,
    description,
    allowAllOutbound: false,
  });
  sg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS egress to AWS endpoints and image registries');
  return sg;
}
