import * as ecs from 'aws-cdk-lib/aws-ecs';

/**
 * Wire protocol the inference server speaks. Drives the Mode B target-group
 * protocol/version; ignored in Mode A (queue) where the worker talks to the
 * model over `localhost`.
 */
export type InferenceProtocol = 'HTTP' | 'HTTP2' | 'GRPC';

/**
 * Provider-agnostic description of a model-server container.
 *
 * This is the abstraction that keeps the library generic across inference
 * servers (vLLM, NVIDIA Triton, TGI, SGLang, …): nothing here assumes a
 * particular server. Use the {@link InferenceContainer} presets to fill in
 * sensible per-server defaults, or provide every field yourself.
 */
export interface InferenceContainerProps {
  /**
   * The container image to run. Consumer-provided (e.g. `ecs.ContainerImage.fromEcrRepository(...)`).
   */
  readonly image: ecs.ContainerImage;

  /**
   * The port the server listens on inside the container.
   */
  readonly containerPort: number;

  /**
   * The wire protocol exposed on {@link containerPort}.
   *
   * @default 'HTTP'
   */
  readonly protocol?: InferenceProtocol;

  /**
   * HTTP path polled for container health (used to build the ECS `HEALTHY`
   * health check and, in Mode B, the ALB target-group health check).
   *
   * @default '/health'
   */
  readonly healthCheckPath?: string;

  /**
   * Number of GPUs to reserve for the container.
   *
   * @default 1
   */
  readonly gpuCount?: number;

  /**
   * Hard memory limit (MiB) for the container. The default fits a 16 GiB
   * instance alongside the worker sidecar; raise it for larger models.
   *
   * @default 12288
   */
  readonly memoryLimitMiB?: number;

  /**
   * Reserved CPU units (1024 = 1 vCPU) for the container.
   *
   * @default 2048
   */
  readonly cpu?: number;

  /**
   * Environment variables passed to the container.
   *
   * @default - none
   */
  readonly environment?: { [key: string]: string };

  /**
   * Entry-point command override.
   *
   * @default - the image's own entrypoint/command
   */
  readonly command?: string[];

  /**
   * Full ECS health-check command for the model container. Override this when
   * the image lacks `curl` (the default probe uses it), for example to use a
   * Python-based check.
   *
   * @default - `['CMD-SHELL', 'curl -f http://localhost:<port><healthCheckPath> || exit 1']`
   */
  readonly healthCheckCommand?: string[];

  /**
   * Grace period (seconds) before failed health checks count, giving the server
   * time to load weights. ECS caps this at 300 (the maximum allowed); larger
   * models should bake weights into the image rather than exceed it.
   *
   * @default 300
   */
  readonly healthCheckStartPeriodSeconds?: number;
}

/**
 * Factory of {@link InferenceContainerProps} with per-server defaults.
 *
 * The presets only prefill port and health-check path — the returned object is
 * a plain {@link InferenceContainerProps} you can spread and override. This keeps
 * the core generic while giving turnkey defaults for common servers.
 *
 * @example
 * InferenceContainer.vllm({ image: myImage });
 * InferenceContainer.triton({ image: myImage, gpuCount: 2 });
 * InferenceContainer.custom({ image: myImage, containerPort: 8091 }); // e.g. the Qwen3-TTS sample
 */
export class InferenceContainer {
  /** vLLM OpenAI-compatible server. Defaults: HTTP :8000, health `/health`. */
  public static vllm(
    props: Partial<InferenceContainerProps> & Pick<InferenceContainerProps, 'image'>,
  ): InferenceContainerProps {
    return { containerPort: 8000, protocol: 'HTTP', healthCheckPath: '/health', ...props };
  }

  /** NVIDIA Triton Inference Server. Defaults: HTTP :8000, health `/v2/health/ready`. */
  public static triton(
    props: Partial<InferenceContainerProps> & Pick<InferenceContainerProps, 'image'>,
  ): InferenceContainerProps {
    return { containerPort: 8000, protocol: 'HTTP', healthCheckPath: '/v2/health/ready', ...props };
  }

  /** Hugging Face Text Generation Inference (TGI). Defaults: HTTP :80, health `/health`. */
  public static tgi(
    props: Partial<InferenceContainerProps> & Pick<InferenceContainerProps, 'image'>,
  ): InferenceContainerProps {
    return { containerPort: 80, protocol: 'HTTP', healthCheckPath: '/health', ...props };
  }

  /** No preset — you supply `containerPort` (and everything else) explicitly. */
  public static custom(props: InferenceContainerProps): InferenceContainerProps {
    return { ...props };
  }

  private constructor() {}
}

/**
 * Resolved defaults shared by the container builders. Kept here so the base
 * construct and tests agree on a single source of truth.
 */
export const INFERENCE_CONTAINER_DEFAULTS = {
  protocol: 'HTTP' as InferenceProtocol,
  healthCheckPath: '/health',
  gpuCount: 1,
  memoryLimitMiB: 12288,
  cpu: 2048,
  healthCheckStartPeriodSeconds: 300,
};
