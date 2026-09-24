# Architecture

Both modes share one compute core and differ only in how work reaches the model.

Each mode construct creates its own cluster and capacity provider by default, but both
accept an existing `cluster` and `capacityProvider`. Passing them lets several services run
in one cluster (the sample does this: the queue service creates the cluster and the API
service reuses it), which keeps the account to a single VPC and cluster.

## Shared core (`GpuInferenceBase`)

- **ECS cluster** with enhanced Container Insights (or a reused one passed via `cluster`).
- **Managed Instances capacity provider** that selects GPU hosts by attribute (NVIDIA
  accelerator, 1 GPU, 16 GiB VRAM or more, 4 to 16 vCPU, 16 to 64 GiB memory by default,
  which favors low-cost families such as g4dn). ECS launches, patches, and drains the EC2
  GPU instances. The L2 construct creates the infrastructure role and instance profile from
  the AWS-managed policies. See the README for how to raise these for larger models.
- **Task definition** with `awsvpc` networking and `MANAGED_INSTANCES` compatibility. The
  model container reserves a GPU and runs an HTTP health check against the server's health
  path. Container resources are reserved at the container level, matching the sample.
- **Security groups**: an egress-only group (TCP 443) for the task ENIs and one for the
  instances.
- **Log groups** under `/ecs/<projectName>/`.

The service is built as an L1 `CfnService`. The L2 `Ec2Service` and `FargateService` both
force a `launchType` and validate for ASG or Fargate capacity, neither of which fits a
Managed Instances capacity-provider strategy, so the service drops to L1 while every other
resource stays L2.

## Mode A: queue (async, scale-to-zero)

```
client --> S3 async-input/  +  SQS job queue
                                   |
                    ApproximateNumberOfMessagesVisible >= 1
                                   |
                         ECS service 0 -> 1
                                   |
                 task = [ model container ] <-localhost- [ worker sidecar ]
                                   |                              |
                          GPU inference                   read S3 input,
                                                          write S3 async-output/
```

- One task holds the model container and a worker sidecar. The worker waits for the model
  to report healthy, then polls SQS one message at a time and calls the model over
  `localhost`. The worker ships with the construct (its source lives in `cdk/worker/` and is
  built as a CDK container asset at deploy). It is model-agnostic and configured through
  typed `worker` props; a custom `workerImage` overrides it for non-JSON protocols.
- Application Auto Scaling drives desired count with two step policies (exact capacity).
  Scale-out to 1 fires on `ApproximateNumberOfMessagesVisible >= 1`. Scale-in to 0 fires
  only when visible plus in-flight messages reach 0, computed with a metric-math
  expression, so a task mid-inference is not terminated.
- The job queue redrives to a dead-letter queue after 5 failed receives.

## Mode B: API (online)

```
client --> ALB listener --> IP target group --> ECS service (min 1) --> model container
                                                        |
                            ALBRequestCountPerTarget target tracking
```

- The model container is registered with an ALB target group (`IP` targets, required by
  `awsvpc`). ECS registers the task ENIs through the service's load-balancer config.
- Autoscaling tracks ALB request-count-per-target and keeps `minCapacity` (>= 1) warm.
  There is no worker and no SQS.
- gRPC servers use a gRPC-over-HTTP2 target group when `protocol: 'GRPC'` is set on the
  model container.

## Observability

`createInferenceDashboard` is an optional construct that builds a CloudWatch dashboard from the
mode constructs' public fields (cluster, service, queues, load balancer, target group, log
group). It charts fleet size, compute, the mode front-end, and logs. GPU metrics are not
included, because nothing emits them on ECS; that work is tracked in a repo issue.

## What the consumer provides

The VPC and subnets, the S3 data bucket (Mode A), and the model image are passed in. The
worker image is provided by the construct (overridable). The library grants the task role
scoped access to the queue and to the S3 key prefixes but never creates the bucket, so its
lifecycle and retention stay under consumer control.
