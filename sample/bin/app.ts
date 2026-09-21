#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { QueueExampleStack } from '../lib/queue-example';
import { ApiExampleStack } from '../lib/api-example';
import { env } from '../lib/common';

/**
 * Sample CDK app wiring both deployment modes of cdk-ecs-gpu-inference-server.
 * The reusable constructs live in the sibling `cdk/` package.
 */
const app = new App();
new QueueExampleStack(app, 'GpuInferenceQueueExample', { env });
new ApiExampleStack(app, 'GpuInferenceApiExample', { env });
app.synth();
