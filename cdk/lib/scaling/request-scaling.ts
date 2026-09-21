import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import * as appscaling from 'aws-cdk-lib/aws-applicationautoscaling';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { RequestScalingOptions } from '../types';

export interface RequestScalingProps {
  /** `service/<cluster>/<service>` — the App Auto Scaling resource id. */
  readonly resourceId: string;
  readonly loadBalancer: elbv2.ApplicationLoadBalancer;
  readonly targetGroup: elbv2.ApplicationTargetGroup;
  readonly options?: RequestScalingOptions;
}

/**
 * Target-tracking autoscaling for Mode B: keep ALB request-count-per-target at
 * `requestsPerTarget`. Unlike Mode A this does not scale to zero — online APIs
 * keep `minCapacity` (>= 1) warm.
 */
export function createRequestScaling(
  scope: Construct,
  id: string,
  props: RequestScalingProps,
): appscaling.ScalableTarget {
  const options = props.options ?? {};

  const scalableTarget = new appscaling.ScalableTarget(scope, `${id}Target`, {
    serviceNamespace: appscaling.ServiceNamespace.ECS,
    resourceId: props.resourceId,
    scalableDimension: 'ecs:service:DesiredCount',
    minCapacity: options.minCapacity ?? 1,
    maxCapacity: options.maxCapacity ?? 4,
  });

  scalableTarget.scaleToTrackMetric(`${id}Track`, {
    predefinedMetric: appscaling.PredefinedMetric.ALB_REQUEST_COUNT_PER_TARGET,
    resourceLabel: `${props.loadBalancer.loadBalancerFullName}/${props.targetGroup.targetGroupFullName}`,
    targetValue: options.requestsPerTarget ?? 30,
    scaleInCooldown: Duration.seconds(options.scaleInCooldown ?? 60),
    scaleOutCooldown: Duration.seconds(options.scaleOutCooldown ?? 60),
  });

  return scalableTarget;
}
