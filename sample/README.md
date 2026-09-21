# GPU inference sample

> [!WARNING]
> **Deploying this costs real money.** It launches NVIDIA GPU EC2 instances plus a NAT
> gateway (and a load balancer in API mode). The API stack keeps a GPU instance running
> around the clock. Deploy into an account you control, watch your spend, and run
> `make destroy STACK=...` when you are done.

A deployable CDK app that consumes the `cdk-ecs-gpu-inference-server` library from the
sibling [`cdk/`](../cdk) package and stands up both modes as separate stacks. Both serve
the same small model, `Qwen/Qwen2.5-1.5B-Instruct`, on **vLLM** (OpenAI-compatible API).
The model is small and ungated so it fits the cheap default GPU (a T4 on `g4dn`) and
downloads at container start with no token.

- `GpuInferenceQueueExample` runs Mode A. One task holds the vLLM server plus a worker
  sidecar that polls SQS, calls the model over `localhost`, and writes results to S3.
- `GpuInferenceApiExample` runs Mode B. vLLM sits behind an ALB and answers
  `POST /v1/chat/completions`.

Each stack creates the satellite resources a real consumer owns (a VPC, and for Mode A an
S3 data bucket) and hands them to the construct.

## How it works

The sample depends on the library through a `file:../cdk` path dependency. `make install`
builds the library first, so its `dist/` exists, then installs it here. The two stacks live
in [`lib/`](lib) and the app entry point is [`bin/app.ts`](bin/app.ts).

The Mode A worker comes from the library itself (its source lives in `cdk/worker/`), built
as a CDK container asset. On `make deploy`, CDK builds that image and pushes it to its
bootstrap ECR, then wires it into the task definition. Because vLLM speaks the OpenAI
protocol, the sample passes no worker configuration. `make synth` and `make template` only
stage and hash the build context, so they do not need Docker.

## Prerequisites

- AWS credentials for the target account.
- A container builder, running, for `deploy` and `bootstrap` (the worker asset is built
  locally). On machines where Docker Desktop is restricted (for example Amazon-managed
  laptops), use Finch: `finch vm init` once, `finch vm start`, then run the deploy commands
  with `CDK_DOCKER=finch` (for example `CDK_DOCKER=finch make deploy STACK=...`).
- A bootstrapped environment (`make bootstrap`, once per account and Region).
- GPU capacity in the account for the AZs your subnets cover.

The first deploy is slow. ECS pulls the multi-gigabyte vLLM image and vLLM downloads the
model weights before the container reports healthy, which can take 10 to 20 minutes.

## Commands

Run these from this directory. `STACK` defaults to `--all`; set it to one stack name to
scope a command.

```sh
make synth                                   # synthesize both stacks (no Docker needed)
make template                                # write templates to ../templates/
make bootstrap                               # once per account/Region
make deploy STACK=GpuInferenceApiExample
make destroy STACK=GpuInferenceApiExample
```

Once a stack is deployed, exercise it. `PROMPT` overrides the input.

```sh
make invoke-api PROMPT="Explain ECS in one sentence."     # curls the ALB endpoint
make invoke-queue PROMPT="Explain ECS in one sentence."   # submits an S3+SQS job, waits for the result
```

The API stack's ALB is **internet-facing** so `invoke-api` can reach it. That exposes an
open inference endpoint, which is fine for a throwaway demo but not for production. For
anything real, make it internal and reach it from inside the VPC.
