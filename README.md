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

> [!WARNING]
> **This provisions GPU EC2 instances that cost real money.** ECS Managed Instances launches
> NVIDIA GPU hosts (g4dn/g5/g6 class) that bill per hour whenever a task runs, plus a NAT
> gateway, data transfer, and load balancer in the API mode. The API mode keeps at least one
> GPU instance running around the clock. An idle g5 or g6 instance alone runs into hundreds
> of dollars a month, and larger overrides cost far more. Queue mode scales to zero when the
> queue is empty, but a stuck task or a busy queue keeps a GPU running. Deploy into an
> account you control, watch your spend, and run `make destroy` when you are done.

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
- [CloudFormation templates](#cloudformation-templates)
- [Sample](#sample)
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
  model: InferenceContainer.vllm({ image: ecs.ContainerImage.fromEcrRepository(repo, 'latest') }),
  // No worker image needed for an OpenAI-compatible server.
});
```

The construct ships its own worker (an SQS poller built as a CDK asset, so `deploy` needs
Docker). It waits for the model to be healthy, reads each job's S3 input, calls the model,
and writes the result to the matching `async-output/` key. It speaks the OpenAI protocol by
default and discovers the served model from `/v1/models`, so a vLLM/TGI/SGLang server needs
no worker configuration.

Tune the worker through typed `worker` props (mapped to the container's env). Supply your
own `workerImage` only for protocols the built-in worker cannot express, such as
binary/audio (TTS) or tensor APIs.

```ts
new QueueInferenceServer(this, 'Inference', {
  vpc, vpcSubnets, dataBucket,
  model: InferenceContainer.vllm({ image }),
  worker: {
    requestStyle: 'completions', // 'chat' (default) | 'completions' | 'raw'
    inputField: 'text', // field in the S3 input JSON (default 'prompt')
    responsePointer: 'choices.0.text', // dotted path into the response
    // modelId, inferPath, cpu, memoryLimitMiB, environment also available
  },
});
```

The task role gets consume access on the job queue, send access on the dead-letter queue,
and S3 access scoped to the `async-input/` and `async-output/` key prefixes.

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
| `gpuInstanceRequirements` | `GpuInstanceRequirements` | see below                  | Attribute-based instance selection.    |
| `logRetentionDays`        | `number`                  | `14`                       | Container log-group retention.         |
| `cluster`                 | `ecs.Cluster`             | a new cluster              | Reuse an existing cluster.             |
| `capacityProvider`        | `ecs.ManagedInstancesCapacityProvider` | a new provider | Reuse an existing GPU capacity provider. |

To run several inference services in **one cluster**, let the first instance create the
cluster and capacity provider, then pass its `cluster` and `capacityProvider` to the others.
Give each instance a distinct `projectName` so their log groups do not collide.

Mode A adds required `dataBucket`, plus optional `workerImage` (defaults to the built-in
worker), `worker` (typed knobs: `requestStyle`, `inferPath`, `inputField`, `responsePointer`,
`modelId`, `cpu`, `memoryLimitMiB`, `environment`), `queue`, `scaling`, `inputPrefix`
(`'async-input/'`), and `outputPrefix` (`'async-output/'`).

Mode B adds optional `loadBalancer` (internal or internet-facing, listener port, TLS
certificate) and `scaling` (target tracking, `minCapacity` of 1 or more).

### GPU instance selection

The cluster runs on ECS Managed Instances, which picks EC2 GPU instances by attribute
rather than a fixed type. There is no single instance type to name. ECS launches whatever
matches the requirements and has capacity in your subnets' AZs, and it picks up new
matching families automatically as AWS releases them.

The defaults aim at the cheapest workable GPU hosts.

| Attribute                   | Default   | Effect                                          |
| --------------------------- | --------- | ----------------------------------------------- |
| GPU count                   | 1         | One GPU per instance.                           |
| GPU vendor                  | NVIDIA    | NVIDIA accelerators only.                       |
| `acceleratorTotalMemoryMin` | 16 GiB    | Allows 16 GiB-VRAM parts such as the T4.         |
| `vCpuCountMin` / `Max`      | 4 / 16    | Keeps ECS off large boxes.                      |
| `memoryMin` / `Max`         | 16 / 64 GiB | System memory band.                           |

With those defaults the pool is mostly the low-cost single-GPU families: `g4dn` (T4,
16 GiB), plus smaller `g5` (A10G, 24 GiB) and `g6` (L4, 24 GiB) sizes when a `g4dn` is not
available. The model container default reserves 2 vCPU and 12 GiB, which fits a
`g4dn.xlarge` (4 vCPU, 16 GiB) next to the worker sidecar.

The model container default of 12 GiB is smaller than the original sample's 20 GiB. A model
that needs more GPU or host memory will not fit a T4, so raise both the instance floor and
the container reservation together.

```ts
new QueueInferenceServer(this, 'Inference', {
  vpc,
  vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
  dataBucket,
  workerImage,
  // Require an A10G/L4-class GPU (24 GiB VRAM) and a larger host.
  gpuInstanceRequirements: {
    acceleratorTotalMemoryMin: Size.mebibytes(24576),
    vCpuCountMin: 8,
    vCpuCountMax: 48,
    memoryMin: Size.mebibytes(32768),
    memoryMax: Size.mebibytes(196608),
  },
  model: InferenceContainer.vllm({
    image,
    memoryLimitMiB: 28672, // must fit inside the instances above
    cpu: 8192,
  }),
});
```

Two rules keep a configuration valid. The model container `cpu` and `memoryLimitMiB` (plus
the worker's, in Mode A) must fit inside `memoryMin`, and `acceleratorTotalMemoryMin` must
match the VRAM the model actually needs. To allow multi-GPU hosts, raise `acceleratorCountMax`
and set the container `gpuCount` to match.

## Outputs

Both constructs expose their created resources as public readonly fields for wiring. The
shared fields are `cluster`, `capacityProvider`, `taskDefinition`, `modelContainer`,
`taskSecurityGroup`, `modelLogGroup`, and `instanceSecurityGroup` (present only when the
construct creates the capacity provider). `QueueInferenceServer` adds `jobQueue`,
`deadLetterQueue`, `workerContainer`, `service`, and `scaling`. `ApiInferenceServer` adds
`loadBalancer`, `listener`, `targetGroup`, `service`, and `scalableTarget`.

## CloudFormation templates

For deploying **without CDK**, the repo ships two standalone, parameterized CloudFormation
templates in [`templates/`](templates), one per mode:

- `gpu-inference-queue.yaml` — queue (async, scale-to-zero) mode.
- `gpu-inference-api.yaml` — API (online, internal ALB) mode.

You pick the mode by choosing which template to deploy; there is no mode switch inside a
template. Each takes CloudFormation Parameters (`VpcId`, `PrivateSubnetId1/2`, `ModelId`,
`ModelImage`, and for the queue template `DataBucketName` + `WorkerImage`) and creates the
cluster, GPU capacity provider, task, service, and the rest. Deploy one with:

```sh
aws cloudformation deploy --template-file templates/gpu-inference-queue.yaml \
  --stack-name gpu-inference --capabilities CAPABILITY_IAM \
  --parameter-overrides VpcId=vpc-… PrivateSubnetId1=subnet-… PrivateSubnetId2=subnet-… \
    DataBucketName=my-bucket WorkerImage=<your-ecr-image>
```

The templates reference the container images by parameter (no CDK assets), so the model
image defaults to public `vllm/vllm-openai` and you supply a prebuilt worker image.

They are generated from [`cdk/templates/`](cdk/templates) with `make template` in `cdk/`.

## Samples

All samples live under [`samples/`](samples):

- [`samples/combined/`](samples/combined) — a deployable CDK app that runs both modes as two
  services in one shared VPC and cluster, on real vLLM, so you can deploy and exercise it end
  to end. Its [README](samples/combined/README.md) covers the commands.
- [`samples/queue/`](samples/queue) and [`samples/api/`](samples/api) — single-file,
  copy-paste stacks for one mode each. They create no satellite resources; the VPC, subnets,
  and bucket are imported and passed in, showing how a real consumer wires the construct into
  an existing account.

## Build

The library lives under [`cdk/`](cdk) and the deployable sample under
[`samples/combined/`](samples/combined). Each has its own `Makefile`.

Build, lint, test the library, and generate the standalone templates.

```sh
cd cdk
make build     # tsc -> dist (compiled declarations)
make lint      # eslint + prettier --check
make test      # install, lint, then jest (template assertions + cdk-nag)
make template  # write templates/gpu-inference-{queue,api}.yaml
```

Synthesize, deploy, or tear down the sample. Its `install` builds the library first, so a
fresh checkout works with a bare `make synth`.

```sh
cd samples/combined
make synth                     # synthesize the sample stack
CDK_DOCKER=finch make deploy   # build the worker image and deploy (Docker/Finch required)
make destroy
```

## Testing

The library tests assert the synthesized template for both modes
(`cdk/test/queue-inference-server.test.ts` and `cdk/test/api-inference-server.test.ts`) and
run cdk-nag `AwsSolutions` checks with documented suppressions (`cdk/test/nag.test.ts`).

## Docs

- [Architecture](docs/architecture.md)
- [Samples](samples/README.md): the deployable combined app and the copy-paste per-mode stacks

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [code of conduct](CODE_OF_CONDUCT.MD).

## License

[MIT](LICENSE).
