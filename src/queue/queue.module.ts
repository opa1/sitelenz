import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import IORedis from 'ioredis';
import { AppConfigService } from '../config';
import {
  ANALYSIS_QUEUE,
  ANALYZE_AI_SUMMARY_QUEUE,
  ANALYZE_BUSINESS_QUEUE,
  ANALYZE_FULL_QUEUE,
  ANALYZE_PERFORMANCE_QUEUE,
  ANALYZE_SCREENSHOTS_QUEUE,
  ANALYZE_SECURITY_QUEUE,
  ANALYZE_SEO_QUEUE,
  ANALYZE_STANDARD_QUEUE,
  ANALYZE_TECHNOLOGY_QUEUE,
  ANALYZE_UX_ACCESSIBILITY_QUEUE,
  ANALYZE_WEBHOOK_QUEUE,
  WEBHOOK_QUEUE,
} from './queue.constants';

@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: (appConfigService: AppConfigService) => ({
        connection: new IORedis(appConfigService.redisUrl, {
          maxRetriesPerRequest: null,
        }),
        // Namespaces every key this app's queues write - required on a
        // Redis instance shared with other apps; omitted (falls back to
        // BullMQ's own default "bull" prefix) when unset.
        prefix: appConfigService.redisKeyPrefix,
        // Bound how long finished jobs linger in Redis. BullMQ keeps completed
        // AND failed jobs forever by default, so Redis grows unboundedly with
        // traffic. AnalyzeJob status/result live in Postgres (what the
        // status/result endpoints actually read), so these Redis copies are
        // pure bookkeeping; and retry re-adds a job from Postgres data
        // (base-analyze.controller.ts removes the old one first), so pruning
        // failed jobs is safe too.
        defaultJobOptions: {
          removeOnComplete: { age: 3600, count: 1000 },
          removeOnFail: { age: 86_400, count: 5000 },
        },
      }),
      inject: [AppConfigService],
    }),
    BullModule.registerQueue(
      { name: ANALYSIS_QUEUE },
      { name: WEBHOOK_QUEUE },
      { name: ANALYZE_WEBHOOK_QUEUE },
      { name: ANALYZE_TECHNOLOGY_QUEUE },
      { name: ANALYZE_SEO_QUEUE },
      { name: ANALYZE_SECURITY_QUEUE },
      { name: ANALYZE_BUSINESS_QUEUE },
      { name: ANALYZE_PERFORMANCE_QUEUE },
      { name: ANALYZE_UX_ACCESSIBILITY_QUEUE },
      { name: ANALYZE_SCREENSHOTS_QUEUE },
      { name: ANALYZE_AI_SUMMARY_QUEUE },
      { name: ANALYZE_STANDARD_QUEUE },
      { name: ANALYZE_FULL_QUEUE },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
