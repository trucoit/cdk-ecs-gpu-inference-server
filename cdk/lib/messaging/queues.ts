import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { QueueOptions } from '../types';

/** The job queue + its dead-letter queue created for Mode A. */
export interface JobQueues {
  readonly jobQueue: sqs.Queue;
  readonly deadLetterQueue: sqs.Queue;
}

/**
 * Creates the SQS job queue and dead-letter queue that drive Mode A. These are
 * core to the queue-driven, scale-to-zero pattern (the scaling alarms watch the
 * job queue's depth), so the construct owns them rather than the consumer.
 */
export function createJobQueues(scope: Construct, id: string, options: QueueOptions = {}): JobQueues {
  const deadLetterQueue = new sqs.Queue(scope, `${id}Dlq`, {
    // 14-day retention gives operators time to inspect poison messages.
    retentionPeriod: Duration.days(14),
    enforceSSL: true,
  });

  const jobQueue = new sqs.Queue(scope, id, {
    visibilityTimeout: Duration.seconds(options.visibilityTimeoutSeconds ?? 1200),
    receiveMessageWaitTime: Duration.seconds(options.longPollSeconds ?? 20),
    retentionPeriod: Duration.seconds(options.retentionSeconds ?? 86400),
    enforceSSL: true,
    deadLetterQueue: {
      queue: deadLetterQueue,
      maxReceiveCount: options.maxReceiveCount ?? 5,
    },
  });

  return { jobQueue, deadLetterQueue };
}
