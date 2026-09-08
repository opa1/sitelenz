import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { CrawlCacheService } from './crawl-cache.service';
import { AnalyzeWebhookService } from './analyze-webhook.service';
import { AnalyzeWebhookProcessor } from './analyze-webhook.processor';
import { LightweightFetchService } from './lightweight-fetch.service';
import { HeavyAnalyzeConcurrencyGate } from './heavy-analyze-concurrency.service';
import { BaseAnalyzeController } from './base-analyze.controller';
import { DiscoveryController } from './discovery.controller';

// The per-endpoint modules (technology/seo/security/business/performance/
// ux-accessibility/screenshots/ai-summary/standard/full) each import this
// one for the shared plumbing: crawl cache, lightweight fetch, webhook
// delivery, the heavy-endpoint browser-concurrency gate, and the
// BaseAnalyzeController helper their own controllers delegate to. The only
// controller registered here directly is the plain GET /v1/analyze catalog.
@Module({
  imports: [QueueModule],
  controllers: [DiscoveryController],
  providers: [
    CrawlCacheService,
    AnalyzeWebhookService,
    AnalyzeWebhookProcessor,
    LightweightFetchService,
    HeavyAnalyzeConcurrencyGate,
    BaseAnalyzeController,
  ],
  exports: [
    CrawlCacheService,
    AnalyzeWebhookService,
    LightweightFetchService,
    HeavyAnalyzeConcurrencyGate,
    BaseAnalyzeController,
  ],
})
export class AnalyzeModule {}
