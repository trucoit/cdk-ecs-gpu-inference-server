import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { InferenceContainer, InferenceContainerProps } from 'cdk-ecs-gpu-inference-server';

/** Account/region the sample stacks deploy into (from your CDK environment). */
export const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

/**
 * The model both sample modes serve. Small and ungated so it fits the cheap
 * default GPU (a T4 on g4dn) and downloads at container start with no token.
 */
export const MODEL_ID = 'Qwen/Qwen2.5-1.5B-Instruct';

/** Pinned vLLM OpenAI-compatible server image. */
const VLLM_IMAGE = 'vllm/vllm-openai:v0.6.6';

/**
 * The vLLM model container shared by both sample modes. Serves {@link MODEL_ID}
 * on port 8000 with an OpenAI-compatible API.
 *
 * The health check uses Python (present in the vLLM image) rather than curl,
 * and allows 10 minutes of start time for the first weights download.
 */
export function vllmModel(): InferenceContainerProps {
  return InferenceContainer.vllm({
    image: ecs.ContainerImage.fromRegistry(VLLM_IMAGE),
    command: ['--model', MODEL_ID, '--max-model-len', '8192', '--gpu-memory-utilization', '0.9'],
    environment: { VLLM_WORKER_MULTIPROC_METHOD: 'spawn' },
    healthCheckCommand: [
      'CMD-SHELL',
      "python3 -c \"import urllib.request; urllib.request.urlopen('http://localhost:8000/health')\" || exit 1",
    ],
    healthCheckStartPeriodSeconds: 600,
  });
}

/**
 * A private VPC with a NAT and an S3 gateway endpoint, the kind of VPC you'd
 * pass into the constructs. The library never creates a VPC itself; the sample
 * creates one only to have something to hand in.
 */
export function exampleVpc(scope: Construct): ec2.Vpc {
  const vpc = new ec2.Vpc(scope, 'Vpc', { maxAzs: 3, natGateways: 1 });
  vpc.addGatewayEndpoint('S3Endpoint', { service: ec2.GatewayVpcEndpointAwsService.S3 });
  return vpc;
}
