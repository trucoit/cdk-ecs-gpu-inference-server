#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { QueueExampleStack } from './queue-example';
import { ApiExampleStack } from './api-example';
import { env } from './common';

/**
 * Example CDK app wiring both deployment modes. This is the app `cdk.json`
 * points at; the reusable constructs live under `lib/`.
 */
const app = new App();
new QueueExampleStack(app, 'GpuInferenceQueueExample', { env });
new ApiExampleStack(app, 'GpuInferenceApiExample', { env });
app.synth();
