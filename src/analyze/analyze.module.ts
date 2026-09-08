import { Module } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { CrawlCacheService } from './crawl-cache.service';
import { AnalyzeWebhookService } from './analyze-webhook.service';
import { AnalyzeWebhookProcessor } from './analyze-webhook.processor';

// No controllers yet - Phase B/C add the per-endpoint routes. This module
// currently only stands up the shared plumbing (crawl cache, queues,
// webhook delivery) those later phases will depend on.
@Module({
  imports: [QueueModule],
  providers: [CrawlCacheService, AnalyzeWebhookService, AnalyzeWebhookProcessor],
  exports: [CrawlCacheService, AnalyzeWebhookService],
})
export class AnalyzeModule {}
