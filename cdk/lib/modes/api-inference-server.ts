import { Construct } from 'constructs';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as appscaling from 'aws-cdk-lib/aws-applicationautoscaling';
import { GpuInferenceBase } from '../base/gpu-inference-base';
import { GpuInferenceBaseProps, RequestScalingOptions } from '../types';
import { INFERENCE_CONTAINER_DEFAULTS } from '../inference-container';
import { MODEL_CONTAINER_NAME } from '../compute/task-definition';
import { AlbOptions, createAlbFrontend } from '../loadbalancer/alb';
import { createRequestScaling } from '../scaling/request-scaling';
import { serviceScalingResourceId } from '../compute/service';

/**
 * Props for {@link ApiInferenceServer} (Mode B — online API).
 */
export interface ApiInferenceServerProps extends GpuInferenceBaseProps {
  /** ALB tuning (internal/internet-facing, listener port, TLS certificate). */
  readonly loadBalancer?: AlbOptions;

  /** Target-tracking scaling tuning (min >= 1). */
  readonly scaling?: RequestScalingOptions;
}

/**
 * **Mode B — API.** Exposes the model server directly as an online API.
 *
 * The model container is fronted by an Application Load Balancer (no worker, no
 * SQS). Autoscaling tracks ALB request-count-per-target and keeps at least one
 * task warm. Generic across inference servers via the {@link InferenceContainer}
 * abstraction (vLLM, Triton, TGI, …).
 */
export class ApiInferenceServer extends GpuInferenceBase {
  /** The Application Load Balancer fronting the model. */
  public readonly loadBalancer: elbv2.ApplicationLoadBalancer;
  /** The ALB listener. */
  public readonly listener: elbv2.ApplicationListener;
  /** The target group ECS registers task ENIs into. */
  public readonly targetGroup: elbv2.ApplicationTargetGroup;
  /** The ECS service. */
  public readonly service: ecs.CfnService;
  /** The autoscaling target. */
  public readonly scalableTarget: appscaling.ScalableTarget;

  constructor(scope: Construct, id: string, props: ApiInferenceServerProps) {
    super(scope, id, props);

    const frontend = createAlbFrontend(this, 'Alb', {
      vpc: props.vpc,
      vpcSubnets: props.vpcSubnets,
      taskSecurityGroup: this.taskSecurityGroup,
      containerPort: props.model.containerPort,
      protocol: props.model.protocol ?? INFERENCE_CONTAINER_DEFAULTS.protocol,
      healthCheckPath: props.model.healthCheckPath ?? INFERENCE_CONTAINER_DEFAULTS.healthCheckPath,
      options: props.loadBalancer,
    });
    this.loadBalancer = frontend.loadBalancer;
    this.listener = frontend.listener;
    this.targetGroup = frontend.targetGroup;

    const desiredCount = props.scaling?.minCapacity ?? 1;
    this.service = this.createService('Service', {
      desiredCount,
      loadBalancers: [
        {
          targetGroupArn: this.targetGroup.targetGroupArn,
          containerName: MODEL_CONTAINER_NAME,
          containerPort: props.model.containerPort,
        },
      ],
      healthCheckGracePeriodSeconds: 300,
    });
    // The listener (and its target group) must exist before the service registers targets.
    this.service.node.addDependency(this.listener);

    this.scalableTarget = createRequestScaling(this, 'Scaling', {
      resourceId: serviceScalingResourceId(this.cluster, this.service),
      loadBalancer: this.loadBalancer,
      targetGroup: this.targetGroup,
      options: props.scaling,
    });
    this.scalableTarget.node.addDependency(this.service);
  }
}
