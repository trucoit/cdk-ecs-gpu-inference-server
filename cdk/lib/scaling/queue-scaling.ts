import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import * as appscaling from 'aws-cdk-lib/aws-applicationautoscaling';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { QueueScalingOptions } from '../types';

/** Handles created by {@link createQueueScaling}, exposed for wiring/inspection. */
export interface QueueScaling {
  readonly scalableTarget: appscaling.ScalableTarget;
  readonly scaleOutAlarm: cloudwatch.Alarm;
  readonly scaleInAlarm: cloudwatch.Alarm;
}

export interface QueueScalingProps {
  /** `service/<cluster>/<service>` — the App Auto Scaling resource id. */
  readonly resourceId: string;
  readonly jobQueue: sqs.IQueue;
  readonly options?: QueueScalingOptions;
}

/**
 * Wires scale-to-zero step scaling for Mode A, faithful to the source sample:
 *
 * - **Scale out** to exact capacity 1 when the job queue has >= 1 visible message.
 * - **Scale in** to exact capacity 0 only when visible **and** in-flight messages
 *   reach 0 (via a metric-math expression), so a running inference is never killed.
 */
export function createQueueScaling(scope: Construct, id: string, props: QueueScalingProps): QueueScaling {
  const options = props.options ?? {};

  const scalableTarget = new appscaling.ScalableTarget(scope, `${id}Target`, {
    serviceNamespace: appscaling.ServiceNamespace.ECS,
    resourceId: props.resourceId,
    scalableDimension: 'ecs:service:DesiredCount',
    minCapacity: options.minCapacity ?? 0,
    maxCapacity: options.maxCapacity ?? 1,
  });

  const scaleOutAction = new appscaling.StepScalingAction(scope, `${id}ScaleOut`, {
    scalingTarget: scalableTarget,
    adjustmentType: appscaling.AdjustmentType.EXACT_CAPACITY,
    cooldown: Duration.seconds(options.scaleOutCooldown ?? 600),
  });
  scaleOutAction.addAdjustment({ adjustment: options.maxCapacity ?? 1, lowerBound: 0 });

  const scaleInAction = new appscaling.StepScalingAction(scope, `${id}ScaleIn`, {
    scalingTarget: scalableTarget,
    adjustmentType: appscaling.AdjustmentType.EXACT_CAPACITY,
    cooldown: Duration.seconds(options.scaleInCooldown ?? 300),
  });
  scaleInAction.addAdjustment({ adjustment: options.minCapacity ?? 0, upperBound: 0 });

  const visible = props.jobQueue.metricApproximateNumberOfMessagesVisible({
    period: Duration.seconds(60),
    statistic: 'Maximum',
  });
  const notVisible = props.jobQueue.metricApproximateNumberOfMessagesNotVisible({
    period: Duration.seconds(60),
    statistic: 'Maximum',
  });

  const scaleOutAlarm = new cloudwatch.Alarm(scope, `${id}ScaleOutAlarm`, {
    metric: visible,
    threshold: 1,
    evaluationPeriods: 1,
    comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
  });
  scaleOutAlarm.addAlarmAction(new cwActions.ApplicationScalingAction(scaleOutAction));

  const backlog = new cloudwatch.MathExpression({
    expression: 'visible + inflight',
    usingMetrics: { visible, inflight: notVisible },
    period: Duration.seconds(60),
  });
  const scaleInAlarm = new cloudwatch.Alarm(scope, `${id}ScaleInAlarm`, {
    metric: backlog,
    threshold: 0,
    evaluationPeriods: 5,
    comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_OR_EQUAL_TO_THRESHOLD,
    treatMissingData: cloudwatch.TreatMissingData.BREACHING,
  });
  scaleInAlarm.addAlarmAction(new cwActions.ApplicationScalingAction(scaleInAction));

  return { scalableTarget, scaleOutAlarm, scaleInAlarm };
}
