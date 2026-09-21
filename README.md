# cdk-ecs-gpu-inference-server

| Branch | Build                           |
| :----: | :-----------------------------: |
| `main` | [![main][main-badge]][workflow] |
| `dev`  | [![dev][dev-badge]][workflow]   |

[workflow]: https://github.com/trucoit/cdk-ecs-gpu-inference-server/actions/workflows/build.yml
[main-badge]: https://github.com/trucoit/cdk-ecs-gpu-inference-server/actions/workflows/build.yml/badge.svg?branch=main&event=push
[dev-badge]: https://github.com/trucoit/cdk-ecs-gpu-inference-server/actions/workflows/build.yml/badge.svg?branch=dev&event=push

AWS CDK (TypeScript) constructs for running GPU inference servers on Amazon ECS
[Managed Instances](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ec2-managed-instances.html).
This is a CDK port of the
[`aws-samples/sample-ecs-gpu-inference`](https://github.com/aws-samples/sample-ecs-gpu-inference)
CloudFormation sample, split into two deployment modes over one shared GPU core.

The library builds only the compute core. That covers the ECS cluster, the Managed
Instances GPU capacity provider, the task definition, the service, autoscaling, IAM roles,
security groups, and log groups. You bring the satellite resources (VPC and subnets, the
S3 data bucket, and the container images), so the same construct drops into an existing
account without creating a VPC or taking ownership of your data.

The model server is described through a provider-agnostic `InferenceContainer`, so the
constructs run vLLM, NVIDIA Triton, TGI, SGLang, or anything else that serves over a port.
Presets fill in the port and health path for the common servers.

> [!IMPORTANT]
> Managed Instances picks GPU hosts by attribute (NVIDIA accelerator with 20 GiB or more
> of VRAM by default) rather than a fixed instance type. Your account needs GPU capacity
> available in the AZs your subnets cover.

## Contents

- [Modes](#modes)
- [Install](#install)
- [Usage](#usage)
  - [Mode A, queue (async, scale-to-zero)](#mode-a-queue-async-scale-to-zero)
  - [Mode B, API (online)](#mode-b-api-online)
- [The InferenceContainer abstraction](#the-inferencecontainer-abstraction)
- [Props](#props)
- [Outputs](#outputs)
- [Build](#build)
- [Testing](#testing)
- [Docs](#docs)
- [Contributing](#contributing)
- [License](#license)

## Modes

| Mode              | Construct              | Front-end                 | Scaling                                  | Load balancer |
| ----------------- | ---------------------- | ------------------------- | ---------------------------------------- | ------------- |
| A, Queue (async)  | `QueueInferenceServer` | SQS + worker sidecar      | SQS-depth alarms, desired count 0<->1    | none          |
| B, API (online)   | `ApiInferenceServer`   | Application Load Balancer | ALB request-count target tracking, min 1 | ALB           |

Mode A follows the sample. One task holds the model container and a worker sidecar that
polls SQS and calls the model over `localhost`. The service sits at desired count 0 and
scales to a single task when a message arrives, then back to 0 once the queue drains. The
scale-in alarm counts visible plus in-flight messages, so a task mid-inference keeps
running until it finishes.

Mode B drops the worker and SQS and puts the model behind an ALB for synchronous request
and response traffic. It keeps at least one task warm.

## Install

The package is not published to npm. Consume it from source (a Git submodule or a
workspace path dependency) and import from `cdk/lib`.

```ts
import { QueueInferenceServer, ApiInferenceServer, InferenceContainer } from 'cdk-ecs-gpu-inference-server';
```

`aws-cdk-lib` (2.219 or later) and `constructs` are peer dependencies you already have in
a CDK app. The Managed Instances L2 support needs a recent `aws-cdk-lib`.

## Usage

### Mode A, queue (async, scale-to-zero)

```ts
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { QueueInferenceServer, InferenceContainer } from 'cdk-ecs-gpu-inference-server';

new QueueInferenceServer(this, 'Inference', {
  vpc, // ec2.IVpc you provide
  vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
  dataBucket, // s3.IBucket you provide, holds job input and output
  model: InferenceContainer.custom({
    image: ecs.ContainerImage.fromEcrRepository(repo, 'v1.0.0-model'),
    containerPort: 8091,
  }),
  workerImage: ecs.ContainerImage.fromEcrRepository(repo, 'v1.0.0-worker'),
});
```

The worker container receives `QUEUE_URL`, `DLQ_URL`, `S3_BUCKET`, `AWS_DEFAULT_REGION`,
`MODEL_ENDPOINT`, and `HEALTH_ENDPOINT` as environment variables. The task role gets
consume access on the job queue, send access on the dead-letter queue, and S3 access
scoped to the `async-input/` and `async-output/` key prefixes.

### Mode B, API (online)

```ts
import { ApiInferenceServer, InferenceContainer } from 'cdk-ecs-gpu-inference-server';

const api = new ApiInferenceServer(this, 'Inference', {
  vpc,
  vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
  model: InferenceContainer.vllm({ image: ecs.ContainerImage.fromEcrRepository(repo, 'latest') }),
  scaling: { minCapacity: 1, maxCapacity: 4 },
});

// Clients send requests to api.loadBalancer.loadBalancerDnsName.
```

The ALB is internal by default. Pass `loadBalancer: { internetFacing: true }` or a
`certificateArn` for a public HTTPS endpoint.

## The InferenceContainer abstraction

`InferenceContainer` is a plain factory of container props. Each preset sets only the port
and health path, which keeps the core generic.

| Preset                        | Port | Health path         |
| ----------------------------- | ---- | ------------------- |
| `InferenceContainer.vllm()`   | 8000 | `/health`           |
| `InferenceContainer.triton()` | 8000 | `/v2/health/ready`  |
| `InferenceContainer.tgi()`    | 80   | `/health`           |
| `InferenceContainer.custom()` | you set every field |              |

Every preset returns a spreadable object, so overriding a default takes one field.

```ts
InferenceContainer.triton({ image, gpuCount: 2, memoryLimitMiB: 32768 });
```

For a gRPC server such as Triton's gRPC endpoint, set `protocol: 'GRPC'`. Mode B then
builds a gRPC-over-HTTP2 target group.

## Props

Shared by both modes (`GpuInferenceBaseProps`).

| Prop                      | Type                      | Default                    | Notes                                  |
| ------------------------- | ------------------------- | -------------------------- | -------------------------------------- |
| `vpc`                     | `ec2.IVpc`                | required                   | Consumer-provided. No VPC is created.  |
| `vpcSubnets`              | `ec2.SubnetSelection`     | required                   | Where instances and task ENIs run.     |
| `model`                   | `InferenceContainerProps` | required                   | Use an `InferenceContainer` preset.    |
| `projectName`             | `string`                  | `'gpu-inference'`          | Prefixes resource and log-group names. |
| `gpuInstanceRequirements` | `GpuInstanceRequirements` | NVIDIA GPU, 20 GiB+ VRAM   | Attribute-based instance selection.    |
| `logRetentionDays`        | `number`                  | `14`                       | Container log-group retention.         |

Mode A adds `dataBucket` and `workerImage` (both required), plus optional `worker`,
`queue`, `scaling`, `inputPrefix` (`'async-input/'`), and `outputPrefix`
(`'async-output/'`).

Mode B adds optional `loadBalancer` (internal or internet-facing, listener port, TLS
certificate) and `scaling` (target tracking, `minCapacity` of 1 or more).

## Outputs

Both constructs expose their created resources as public readonly fields for wiring. The
shared fields are `cluster`, `capacityProvider`, `taskDefinition`, `modelContainer`,
`taskSecurityGroup`, `instanceSecurityGroup`, and `modelLogGroup`. `QueueInferenceServer`
adds `jobQueue`, `deadLetterQueue`, `workerContainer`, `service`, and `scaling`.
`ApiInferenceServer` adds `loadBalancer`, `listener`, `targetGroup`, `service`, and
`scalableTarget`.

## Build

The CDK project lives under [`cdk/`](cdk). A `Makefile` is the entry point for developers
and CI.

```sh
cd cdk
make build     # tsc -> dist (compiled declarations)
make synth     # synthesize the example app
make template  # write the example templates to templates/
make lint      # eslint + prettier --check
```

## Testing

```sh
cd cdk
make test      # install, lint, then jest (template assertions + cdk-nag)
```

Tests assert the synthesized template for both modes (`test/queue-inference-server.test.ts`
and `test/api-inference-server.test.ts`) and run cdk-nag `AwsSolutions` checks with
documented suppressions (`test/nag.test.ts`).

## Docs

- [Architecture](docs/architecture.md)
- [Runnable examples](cdk/examples) with one stack per mode, wired to placeholder images

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [code of conduct](CODE_OF_CONDUCT.MD).

## License

[MIT](LICENSE).
