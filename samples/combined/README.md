# GPU inference sample

> [!WARNING]
> **Deploying this costs real money.** It launches NVIDIA GPU EC2 instances plus a NAT
> gateway and a load balancer. The API service keeps a GPU instance running around the
> clock. Deploy into an account you control, watch your spend, and run `make destroy` when
> you are done.

A deployable CDK app that consumes the `cdk-ecs-gpu-inference-server` library from the
library [`cdk/`](../../cdk) package. It is a single stack, `GpuInferenceSample`, that runs both
modes as two services in **one VPC and one ECS cluster**, sharing the GPU capacity provider.
Both serve `Qwen/Qwen2.5-1.5B-Instruct` on **vLLM** (OpenAI-compatible API). The model is
small and ungated so it fits the cheap default GPU (a T4 on `g4dn`) and downloads at
container start with no token.

- Queue service: Mode A, async and scale-to-zero. A task holds the vLLM server plus the
  library's built-in worker sidecar, which polls SQS, calls the model over `localhost`, and
  writes results to S3. This service creates the shared cluster and capacity provider.
- API service: Mode B, online. vLLM sits behind an ALB and answers `POST /v1/chat/completions`.
  It reuses the queue service's cluster and capacity provider, so no second VPC or cluster
  is created.

## How it works

The sample depends on the library through a `file:../../cdk` path dependency. `make install`
builds the library first, then installs it here. The stack lives in
[`lib/sample-stack.ts`](lib/sample-stack.ts) and the app entry point is
[`bin/app.ts`](bin/app.ts).

The worker comes from the library (`cdk/worker/`), built as a CDK container asset. On
`make deploy`, CDK builds that image and pushes it to its bootstrap ECR. Because vLLM speaks
the OpenAI protocol, the sample passes no worker configuration. `make synth` only stages and
hashes the build context, so it does not need a builder.

(The standalone CloudFormation templates in [`../../templates`](../../templates) are generated
from the library, not this sample — see the root README.)

## Prerequisites

- AWS credentials for the target account.
- A container builder, running, for `deploy` and `bootstrap`. On machines where Docker
  Desktop is restricted (for example Amazon-managed laptops), use Finch: `finch vm init`
  once, `finch vm start`, then run deploy commands with `CDK_DOCKER=finch`.
- A bootstrapped environment (`make bootstrap`, once per account and Region).
- GPU capacity in the account for the AZs your subnets cover.

The first deploy is slow. ECS pulls the multi-gigabyte vLLM image and vLLM downloads the
model weights before the container reports healthy.

## Commands

Run these from this directory.

```sh
make synth                                   # synthesize the stack (no builder needed)
make bootstrap                               # once per account/Region
CDK_DOCKER=finch make deploy                 # build the worker image and deploy
CDK_DOCKER=finch make destroy                # tear everything down
```

Once deployed, exercise both services. `PROMPT` overrides the input.

```sh
make invoke-api PROMPT="Explain ECS in one sentence."     # curls the ALB endpoint
make invoke-queue PROMPT="Explain ECS in one sentence."   # submits an S3+SQS job, waits for the result
```

The ALB is **internet-facing** so `invoke-api` can reach it. That exposes an open inference
endpoint, which is fine for a throwaway demo but not for production.

The stack also builds a CloudWatch dashboard covering both services. Open the `DashboardUrl`
stack output to watch fleet size, CPU and memory, queue depth, API latency, and recent errors
while you exercise the services.
