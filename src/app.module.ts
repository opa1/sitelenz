import { Module } from '@nestjs/common';
import { ConfigModule } from './config';
import { CommonModule } from './common/common.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { BrowserModule } from './common/browser/browser.module';
import { QueueModule } from './queue/queue.module';
import { HealthModule } from './health/health.module';
import { AnalysesModule } from './analyses/analyses.module';
import { WorkersModule } from './workers/workers.module';
import { AiModule } from './ai/ai.module';
import { StorageModule } from './storage/storage.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [
    ConfigModule,
    CommonModule,
    PrismaModule,
    BrowserModule,
    QueueModule,
    HealthModule,
    AnalysesModule,
    WorkersModule,
    AiModule,
    StorageModule,
    WebhooksModule,
  ],
})
export class AppModule {}
