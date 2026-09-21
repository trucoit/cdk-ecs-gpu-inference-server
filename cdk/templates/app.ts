#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { QueueTemplateStack } from './queue-template';
import { ApiTemplateStack } from './api-template';

/**
 * Generates the standalone, parameterized CloudFormation templates for people
 * who deploy the inference setup without CDK. Each stack synthesizes to its own
 * template (see the library `make template` target):
 *   GpuInferenceQueue -> templates/gpu-inference-queue.yaml
 *   GpuInferenceApi   -> templates/gpu-inference-api.yaml
 */
const app = new App();
new QueueTemplateStack(app, 'GpuInferenceQueue');
new ApiTemplateStack(app, 'GpuInferenceApi');
app.synth();
