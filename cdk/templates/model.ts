import * as ecs from 'aws-cdk-lib/aws-ecs';
import { InferenceContainer, InferenceContainerProps } from '../lib';

/**
 * vLLM model container shared by both generated templates. The image and model
 * id come from CloudFormation parameters (resolved at deploy time), so the
 * container serves an OpenAI-compatible API on port 8000 with a Python-based
 * health check (present in the vLLM image).
 */
export function vllmModel(image: ecs.ContainerImage, modelId: string): InferenceContainerProps {
  return InferenceContainer.vllm({
    image,
    // --dtype half (float16) because the default GPU pool includes the T4
    // (compute capability 7.5), which does not support bfloat16.
    command: ['--model', modelId, '--dtype', 'half', '--max-model-len', '8192', '--gpu-memory-utilization', '0.9'],
    environment: { VLLM_WORKER_MULTIPROC_METHOD: 'spawn' },
    healthCheckCommand: [
      'CMD-SHELL',
      'python3 -c "import urllib.request; urllib.request.urlopen(\'http://localhost:8000/health\')" || exit 1',
    ],
    healthCheckStartPeriodSeconds: 300,
  });
}
