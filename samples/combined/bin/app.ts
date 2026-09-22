#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { SampleStack } from '../lib/sample-stack';
import { env } from '../lib/common';

/**
 * Sample CDK app: one stack running both deployment modes of
 * cdk-ecs-gpu-inference-server as two services in a shared cluster. The reusable
 * constructs live in the sibling `cdk/` package.
 */
const app = new App();
new SampleStack(app, 'GpuInferenceSample', { env });
app.synth();
