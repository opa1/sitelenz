import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import IORedis from 'ioredis';
import { AppConfigService } from '../config';
import {
  ANALYSIS_QUEUE,
  ANALYZE_QUEUE,
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
      { name: ANALYZE_QUEUE },
      { name: ANALYZE_WEBHOOK_QUEUE },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
