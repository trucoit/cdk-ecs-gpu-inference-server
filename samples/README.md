# Samples

Three ways to see the constructs in use, from fully runnable to copy-paste.

| Sample | Kind | Creates its own VPC/bucket? | Use it to |
| ------ | ---- | --------------------------- | --------- |
| [`combined/`](combined) | Deployable CDK app | Yes | Deploy and exercise both modes end to end in one shared cluster. |
| [`queue/`](queue) | Copy-paste stack | No, imported | Drop Mode A (async, scale-to-zero) into your own app. |
| [`api/`](api) | Copy-paste stack | No, imported | Drop Mode B (online, ALB) into your own app. |

## combined

A full app with its own `Makefile`, `cdk.json`, and helper scripts. It creates a
VPC, a bucket, and both inference services in one shared cluster, so you can
`make deploy` and then `make invoke-api` / `make invoke-queue`. See its
[README](combined/README.md).

## queue and api

Single-file stacks you copy into your own CDK app. They create no satellite
resources. The VPC, subnets, and (for queue) the S3 bucket are imported and
passed into the construct, which is how the library is meant to be consumed.

- [`queue/queue-inference.ts`](queue/queue-inference.ts) — Mode A.
- [`api/api-inference.ts`](api/api-inference.ts) — Mode B.

Copy one, replace the `vpc-…` / `subnet-…` / bucket identifiers with your own,
and add the stack to your `App`. Both depend on `cdk-ecs-gpu-inference-server`
(see the root README's Install section).
