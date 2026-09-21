import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Size } from 'aws-cdk-lib';
import { InferenceContainerProps } from './inference-container';

/**
 * Attribute-based GPU instance selection for the ECS Managed Instances capacity
 * provider. Mirrors the source sample's `InstanceRequirements`: rather than a
 * fixed instance type, ECS picks any instance matching these constraints.
 */
export interface GpuInstanceRequirements {
  /** @default 1 */
  readonly acceleratorCountMin?: number;
  /** @default 1 */
  readonly acceleratorCountMax?: number;
  /** Minimum total accelerator (GPU) memory. @default Size.mebibytes(16384) (16 GiB, allows T4) */
  readonly acceleratorTotalMemoryMin?: Size;
  /** @default 4 */
  readonly vCpuCountMin?: number;
  /** @default 16 */
  readonly vCpuCountMax?: number;
  /** @default Size.mebibytes(16384) (16 GiB) */
  readonly memoryMin?: Size;
  /** @default Size.mebibytes(65536) (64 GiB) */
  readonly memoryMax?: Size;
}

/**
 * Props shared by both deployment modes ({@link QueueInferenceServerProps} and
 * {@link ApiInferenceServerProps}). These configure the GPU-on-ECS core: the
 * cluster, Managed Instances capacity provider, and the model task/container.
 *
 * The VPC + subnets and the model image are **consumer-provided** — this
 * library creates no networking of its own.
 */
export interface GpuInferenceBaseProps {
  /**
   * The VPC to deploy into. Consumer-provided; this library never creates a VPC.
   */
  readonly vpc: ec2.IVpc;

  /**
   * The subnets that both the GPU instances and the task ENIs are placed in.
   * Typically private subnets with a NAT/endpoints route to pull images and
   * reach AWS APIs.
   */
  readonly vpcSubnets: ec2.SubnetSelection;

  /**
   * The model-server container. Use an {@link InferenceContainer} preset
   * (`vllm`/`triton`/`tgi`) or `custom`.
   */
  readonly model: InferenceContainerProps;

  /**
   * Name used to prefix resource names and CloudWatch log groups
   * (`/ecs/<projectName>/model`, …).
   *
   * @default 'gpu-inference'
   */
  readonly projectName?: string;

  /**
   * Attribute-based GPU instance selection.
   *
   * @default - NVIDIA GPU, 1 accelerator, >=20 GiB VRAM, 4-96 vCPU, 16-512 GiB memory
   */
  readonly gpuInstanceRequirements?: GpuInstanceRequirements;

  /**
   * Retention (days) for the ECS container log groups.
   *
   * @default 14
   */
  readonly logRetentionDays?: number;
}

/**
 * Tunables for the SQS job queue + dead-letter queue created in Mode A.
 */
export interface QueueOptions {
  /** @default Duration.seconds(1200) */
  readonly visibilityTimeoutSeconds?: number;
  /** Long-poll wait time. @default 20 */
  readonly longPollSeconds?: number;
  /** Message retention on the job queue. @default 86400 (1 day) */
  readonly retentionSeconds?: number;
  /** Deliveries before a message is moved to the DLQ. @default 5 */
  readonly maxReceiveCount?: number;
}

/**
 * Scale-to-zero step-scaling tunables for Mode A.
 */
export interface QueueScalingOptions {
  /** @default 0 */
  readonly minCapacity?: number;
  /** @default 1 */
  readonly maxCapacity?: number;
  /** Seconds between scale-out actions. @default 600 */
  readonly scaleOutCooldown?: number;
  /** Seconds between scale-in actions. @default 300 */
  readonly scaleInCooldown?: number;
}

/**
 * Optional worker (sidecar) overrides for Mode A. The worker polls SQS and
 * calls the model over `localhost`; required env vars are injected automatically.
 */
export interface WorkerOptions {
  /** @default 512 */
  readonly cpu?: number;
  /** @default 1024 */
  readonly memoryLimitMiB?: number;
  /** Extra environment variables merged on top of the injected ones. */
  readonly environment?: { [key: string]: string };
  /** Seconds ECS waits for graceful worker shutdown. @default 120 */
  readonly stopTimeoutSeconds?: number;
}

/**
 * Target-tracking scaling tunables for Mode B (online API).
 */
export interface RequestScalingOptions {
  /** @default 1 */
  readonly minCapacity?: number;
  /** @default 4 */
  readonly maxCapacity?: number;
  /** Target ALB requests per task before scaling out. @default 30 */
  readonly requestsPerTarget?: number;
  /** @default 60 */
  readonly scaleInCooldown?: number;
  /** @default 60 */
  readonly scaleOutCooldown?: number;
}
