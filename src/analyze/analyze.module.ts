import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { CrawlCacheService } from './crawl-cache.service';
import { AnalyzeWebhookService } from './analyze-webhook.service';
import { AnalyzeWebhookProcessor } from './analyze-webhook.processor';
import { LightweightFetchService } from './lightweight-fetch.service';
import { BaseAnalyzeController } from './base-analyze.controller';

// No controllers of its own - the per-endpoint modules (technology/seo/
// security/business) each import this one for the shared plumbing: crawl
// cache, lightweight fetch, webhook delivery, and the BaseAnalyzeController
// helper their own controllers delegate to.
@Module({
  imports: [QueueModule],
  providers: [
    CrawlCacheService,
    AnalyzeWebhookService,
    AnalyzeWebhookProcessor,
    LightweightFetchService,
    BaseAnalyzeController,
  ],
  exports: [
    CrawlCacheService,
    AnalyzeWebhookService,
    LightweightFetchService,
    BaseAnalyzeController,
  ],
})
export class AnalyzeModule {}
