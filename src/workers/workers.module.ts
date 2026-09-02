import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { StorageModule } from '../storage/storage.module';
import { TechnologyModule } from '../analyzers/technology/technology.module';
import { SeoModule } from '../analyzers/seo/seo.module';
import { SecurityModule } from '../analyzers/security/security.module';
import { PerformanceModule } from '../analyzers/performance/performance.module';
import { BusinessModule } from '../analyzers/business/business.module';
import { UxModule } from '../analyzers/ux/ux.module';
import { AiModule } from '../ai/ai.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { AnalysisProcessor } from './analysis.processor';
import { WebhookProcessor } from './webhook.processor';

@Module({
  imports: [
    QueueModule,
    StorageModule,
    TechnologyModule,
    SeoModule,
    SecurityModule,
    PerformanceModule,
    BusinessModule,
    UxModule,
    AiModule,
    WebhooksModule,
  ],
  providers: [AnalysisProcessor, WebhookProcessor],
})
export class WorkersModule {}
