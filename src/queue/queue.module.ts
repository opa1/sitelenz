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
