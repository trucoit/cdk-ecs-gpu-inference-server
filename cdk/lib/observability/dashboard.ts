import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { QueueInferenceServer } from '../modes/queue-inference-server';
import { ApiInferenceServer } from '../modes/api-inference-server';

/** Link to the issue tracking GPU-metric collection (see the GPU placeholder widget). */
const GPU_ISSUE_URL = 'https://github.com/trucoit/cdk-ecs-gpu-inference-server/issues/1';

/** A mode construct the dashboard can chart. Both expose `cluster` and `service`. */
export type InferenceService = QueueInferenceServer | ApiInferenceServer;

/** Props for {@link createInferenceDashboard}. */
export interface InferenceDashboardProps {
  /** Dashboard name. @default - CloudFormation generates one */
  readonly dashboardName?: string;
  /** One or more inference services to chart, in one section each. */
  readonly services: InferenceService[];
}

const PERIOD = Duration.minutes(1);
const FULL_WIDTH = 24;

/**
 * Builds a CloudWatch dashboard for one or more inference services.
 *
 * Each service gets a section with a KPI strip, fleet and scaling, compute
 * (CPU/memory/network), the mode-specific front-end (SQS for queue mode, ALB
 * for API mode), and a log query. GPU metrics are not charted yet because
 * nothing emits them on ECS; a placeholder widget links the tracking issue.
 *
 * ECS metrics are built by hand because the service is an L1 `CfnService` with
 * no metric helpers; SQS and ELB metrics use their L2 helpers.
 */
export function createInferenceDashboard(
  scope: Construct,
  id: string,
  props: InferenceDashboardProps,
): cloudwatch.Dashboard {
  const dashboard = new cloudwatch.Dashboard(scope, id, {
    dashboardName: props.dashboardName,
    defaultInterval: Duration.hours(3),
  });

  for (const svc of props.services) {
    const label = svc.node.id;
    dashboard.addWidgets(header(`${label} service (${modeName(svc)})`));
    dashboard.addWidgets(...kpiWidgets(svc, label));
    dashboard.addWidgets(...fleetAndComputeWidgets(svc, label));
    if (svc instanceof QueueInferenceServer) {
      dashboard.addWidgets(...queueWidgets(svc, label));
    } else {
      dashboard.addWidgets(...apiWidgets(svc, label));
    }
    dashboard.addWidgets(logWidget(svc, label));
  }

  dashboard.addWidgets(
    new cloudwatch.TextWidget({
      width: FULL_WIDTH,
      height: 2,
      markdown: [
        '### GPU metrics',
        'GPU utilization, VRAM, temperature, and power are not charted yet, because nothing',
        `emits them on ECS. Tracking: ${GPU_ISSUE_URL}`,
      ].join('\n'),
    }),
  );

  return dashboard;
}

// --- shared helpers ---

function modeName(svc: InferenceService): string {
  return svc instanceof QueueInferenceServer ? 'async, SQS-driven' : 'online, behind an ALB';
}

function header(text: string): cloudwatch.TextWidget {
  return new cloudwatch.TextWidget({ width: FULL_WIDTH, height: 1, markdown: `## ${text}` });
}

function serviceDimensions(svc: InferenceService): Record<string, string> {
  return { ClusterName: svc.cluster.clusterName, ServiceName: svc.service.attrName };
}

/** An `AWS/ECS` percent metric (CPU/memory) for the service. */
function ecsPercentMetric(svc: InferenceService, metricName: string, label: string): cloudwatch.Metric {
  return new cloudwatch.Metric({
    namespace: 'AWS/ECS',
    metricName,
    dimensionsMap: serviceDimensions(svc),
    statistic: 'Average',
    period: PERIOD,
    label,
  });
}

/** An `ECS/ContainerInsights` metric (task counts, network) for the service. */
function insightsMetric(
  svc: InferenceService,
  metricName: string,
  label: string,
  statistic = 'Average',
): cloudwatch.Metric {
  return new cloudwatch.Metric({
    namespace: 'ECS/ContainerInsights',
    metricName,
    dimensionsMap: serviceDimensions(svc),
    statistic,
    period: PERIOD,
    label,
  });
}

function kpiWidgets(svc: InferenceService, label: string): cloudwatch.IWidget[] {
  const running = new cloudwatch.SingleValueWidget({
    title: `${label} running tasks`,
    width: 8,
    height: 4,
    metrics: [insightsMetric(svc, 'RunningTaskCount', 'Running', 'Maximum')],
  });

  if (svc instanceof QueueInferenceServer) {
    return [
      running,
      new cloudwatch.SingleValueWidget({
        title: `${label} messages waiting`,
        width: 8,
        height: 4,
        metrics: [svc.jobQueue.metricApproximateNumberOfMessagesVisible({ period: PERIOD, statistic: 'Maximum' })],
      }),
      new cloudwatch.SingleValueWidget({
        title: `${label} dead-letter messages`,
        width: 8,
        height: 4,
        metrics: [
          svc.deadLetterQueue.metricApproximateNumberOfMessagesVisible({ period: PERIOD, statistic: 'Maximum' }),
        ],
      }),
    ];
  }

  return [
    running,
    new cloudwatch.SingleValueWidget({
      title: `${label} requests/min`,
      width: 8,
      height: 4,
      metrics: [svc.loadBalancer.metrics.requestCount({ period: PERIOD })],
    }),
    new cloudwatch.SingleValueWidget({
      title: `${label} p99 latency`,
      width: 8,
      height: 4,
      metrics: [svc.targetGroup.metrics.targetResponseTime({ period: PERIOD, statistic: 'p99' })],
    }),
  ];
}

function fleetAndComputeWidgets(svc: InferenceService, label: string): cloudwatch.IWidget[] {
  const fleet = new cloudwatch.GraphWidget({
    title: `${label} tasks (running vs desired)`,
    width: 8,
    height: 6,
    left: [
      insightsMetric(svc, 'RunningTaskCount', 'Running', 'Maximum'),
      insightsMetric(svc, 'DesiredTaskCount', 'Desired', 'Maximum'),
    ],
  });

  const compute = new cloudwatch.GraphWidget({
    title: `${label} CPU & memory %`,
    width: 8,
    height: 6,
    left: [ecsPercentMetric(svc, 'CPUUtilization', 'CPU %'), ecsPercentMetric(svc, 'MemoryUtilization', 'Memory %')],
    leftYAxis: { min: 0, max: 100 },
  });

  const network = new cloudwatch.GraphWidget({
    title: `${label} network bytes`,
    width: 8,
    height: 6,
    left: [
      insightsMetric(svc, 'NetworkRxBytes', 'Rx', 'Average'),
      insightsMetric(svc, 'NetworkTxBytes', 'Tx', 'Average'),
    ],
  });

  return [fleet, compute, network];
}

function queueWidgets(svc: QueueInferenceServer, label: string): cloudwatch.IWidget[] {
  const depth = new cloudwatch.GraphWidget({
    title: `${label} message backlog`,
    width: 8,
    height: 6,
    left: [
      svc.jobQueue.metricApproximateNumberOfMessagesVisible({ period: PERIOD, statistic: 'Maximum', label: 'Visible' }),
      svc.jobQueue.metricApproximateNumberOfMessagesNotVisible({
        period: PERIOD,
        statistic: 'Maximum',
        label: 'In flight',
      }),
      svc.deadLetterQueue.metricApproximateNumberOfMessagesVisible({
        period: PERIOD,
        statistic: 'Maximum',
        label: 'Dead-letter',
      }),
    ],
  });

  const age = new cloudwatch.GraphWidget({
    title: `${label} age of oldest message (s)`,
    width: 8,
    height: 6,
    left: [svc.jobQueue.metricApproximateAgeOfOldestMessage({ period: PERIOD, statistic: 'Maximum' })],
  });

  const throughput = new cloudwatch.GraphWidget({
    title: `${label} message throughput`,
    width: 8,
    height: 6,
    left: [
      svc.jobQueue.metricNumberOfMessagesSent({ period: PERIOD, statistic: 'Sum', label: 'Sent' }),
      svc.jobQueue.metricNumberOfMessagesReceived({ period: PERIOD, statistic: 'Sum', label: 'Received' }),
      svc.jobQueue.metricNumberOfMessagesDeleted({ period: PERIOD, statistic: 'Sum', label: 'Deleted' }),
    ],
  });

  const alarms = new cloudwatch.AlarmStatusWidget({
    title: `${label} scaling alarms`,
    width: FULL_WIDTH,
    height: 2,
    alarms: [svc.scaling.scaleOutAlarm, svc.scaling.scaleInAlarm],
  });

  return [depth, age, throughput, alarms];
}

function apiWidgets(svc: ApiInferenceServer, label: string): cloudwatch.IWidget[] {
  const traffic = new cloudwatch.GraphWidget({
    title: `${label} requests & connections`,
    width: 8,
    height: 6,
    left: [svc.loadBalancer.metrics.requestCount({ period: PERIOD, label: 'Requests' })],
    right: [svc.loadBalancer.metrics.activeConnectionCount({ period: PERIOD, label: 'Active connections' })],
  });

  const latency = new cloudwatch.GraphWidget({
    title: `${label} target response time (s)`,
    width: 8,
    height: 6,
    left: [
      svc.targetGroup.metrics.targetResponseTime({ period: PERIOD, statistic: 'p50', label: 'p50' }),
      svc.targetGroup.metrics.targetResponseTime({ period: PERIOD, statistic: 'p90', label: 'p90' }),
      svc.targetGroup.metrics.targetResponseTime({ period: PERIOD, statistic: 'p99', label: 'p99' }),
    ],
  });

  const codes = new cloudwatch.GraphWidget({
    title: `${label} target HTTP codes`,
    width: 8,
    height: 6,
    left: [
      svc.targetGroup.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_2XX_COUNT, {
        period: PERIOD,
        statistic: 'Sum',
        label: '2XX',
      }),
      svc.targetGroup.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_4XX_COUNT, {
        period: PERIOD,
        statistic: 'Sum',
        label: '4XX',
      }),
      svc.targetGroup.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, {
        period: PERIOD,
        statistic: 'Sum',
        label: '5XX',
      }),
    ],
  });

  const hosts = new cloudwatch.GraphWidget({
    title: `${label} healthy vs unhealthy hosts`,
    width: FULL_WIDTH,
    height: 4,
    left: [
      svc.targetGroup.metrics.healthyHostCount({ period: PERIOD, statistic: 'Maximum', label: 'Healthy' }),
      svc.targetGroup.metrics.unhealthyHostCount({ period: PERIOD, statistic: 'Maximum', label: 'Unhealthy' }),
    ],
  });

  return [traffic, latency, codes, hosts];
}

function logWidget(svc: InferenceService, label: string): cloudwatch.IWidget {
  return new cloudwatch.LogQueryWidget({
    title: `${label} recent model errors`,
    width: FULL_WIDTH,
    height: 6,
    logGroupNames: [svc.modelLogGroup.logGroupName],
    queryLines: [
      'fields @timestamp, @message',
      'filter @message like /(?i)(error|exception|traceback|fail)/',
      'sort @timestamp desc',
      'limit 50',
    ],
  });
}
