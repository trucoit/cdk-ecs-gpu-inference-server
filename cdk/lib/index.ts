// Public API surface for cdk-ecs-gpu-inference-server.

// Shared types and the generic inference-server abstraction.
export * from './types';
export * from './inference-container';

// Deployment-mode constructs.
export { GpuInferenceBase, BaseServiceOptions } from './base/gpu-inference-base';
export { QueueInferenceServer, QueueInferenceServerProps, WORKER_CONTAINER_NAME } from './modes/queue-inference-server';
export { ApiInferenceServer, ApiInferenceServerProps } from './modes/api-inference-server';

// Selected building blocks, exposed for advanced composition.
export { AlbOptions, AlbFrontend, AlbFrontendProps, createAlbFrontend } from './loadbalancer/alb';
export { JobQueues, createJobQueues } from './messaging/queues';
export { QueueScaling, QueueScalingProps, createQueueScaling } from './scaling/queue-scaling';
export { RequestScalingProps, createRequestScaling } from './scaling/request-scaling';
export { MODEL_CONTAINER_NAME } from './compute/task-definition';
