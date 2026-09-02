import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import IORedis from 'ioredis';
import { AppConfigService } from '../config';
import { ANALYSIS_QUEUE, WEBHOOK_QUEUE } from './queue.constants';

@Module({
  imports: [
    BullModule.forRootAsync({
      useFactory: (appConfigService: AppConfigService) => ({
        connection: new IORedis(appConfigService.redisUrl, {
          maxRetriesPerRequest: null,
        }),
      }),
      inject: [AppConfigService],
    }),
    BullModule.registerQueue({ name: ANALYSIS_QUEUE }, { name: WEBHOOK_QUEUE }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
