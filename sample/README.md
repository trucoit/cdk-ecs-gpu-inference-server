# GPU inference sample

A deployable CDK app that consumes the `cdk-ecs-gpu-inference-server` library from the
sibling [`cdk/`](../cdk) package and stands up both modes as separate stacks.

- `GpuInferenceQueueExample` runs Mode A (SQS + worker sidecar, scale-to-zero).
- `GpuInferenceApiExample` runs Mode B (ALB, online API).

Each stack creates the satellite resources a real consumer owns (a VPC, and for Mode A an
S3 data bucket) and hands them to the construct. Both use a placeholder `amazonlinux` image
in place of a real model server, so `synth`, `diff`, and `template` work out of the box and
`deploy` stands up the infrastructure. Swap in your own ECR images before expecting
inference to run.

## How it works

The sample depends on the library through a `file:../cdk` path dependency. `make install`
builds the library first, so its `dist/` exists, then installs it here. The two stacks live
in [`lib/`](lib) and the app entry point is [`bin/app.ts`](bin/app.ts).

## Prerequisites

- AWS credentials for the target account.
- A bootstrapped environment (`make bootstrap`, once per account and Region).
- GPU capacity available in the account for the AZs your subnets cover.

## Commands

Run these from this directory. `STACK` defaults to `--all`; set it to one stack name to
scope a command.

```sh
make synth                                   # synthesize both stacks
make diff STACK=GpuInferenceApiExample
make deploy STACK=GpuInferenceApiExample
make destroy STACK=GpuInferenceApiExample
make template                                # write templates to ../templates/
```
