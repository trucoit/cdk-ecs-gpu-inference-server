import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

/** Account/region the example stacks deploy into (from your CDK environment). */
export const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

/**
 * A private VPC with a NAT and an S3 gateway endpoint — the kind of VPC you'd
 * pass into the constructs. The library never creates a VPC itself; the
 * examples create one only to have something to hand in.
 */
export function exampleVpc(scope: Construct): ec2.Vpc {
  const vpc = new ec2.Vpc(scope, 'Vpc', { maxAzs: 3, natGateways: 1 });
  vpc.addGatewayEndpoint('S3Endpoint', { service: ec2.GatewayVpcEndpointAwsService.S3 });
  return vpc;
}
