import { Inject, Logger } from '@nestjs/common';
import { Processor } from '@nestjs/bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BrowserService } from '../../common/browser/browser.service';
import { ObservationCollector } from '../../common/browser/observation-collector.service';
import { LighthouseService } from '../../common/browser/lighthouse.service';
import { ScreenshotCaptureService } from '../../storage/screenshot-capture.service';
import { TechnologyAnalyzerService } from '../../analyzers/technology/technology-analyzer.service';
import { SeoAnalyzerService } from '../../analyzers/seo/seo-analyzer.service';
import { SecurityAnalyzerService } from '../../analyzers/security/security-analyzer.service';
import { PerformanceAnalyzerService } from '../../analyzers/performance/performance-analyzer.service';
import { BusinessAnalyzerService } from '../../analyzers/business/business-analyzer.service';
import { UxAnalyzerService } from '../../analyzers/ux/ux-analyzer.service';
import { AiInputBuilderService } from '../../ai/ai-input-builder.service';
import { AI_PROVIDER } from '../../ai/ai-provider.interface';
import type { AIProvider } from '../../ai/ai-provider.interface';
import {
  ANALYZE_STANDARD_QUEUE,
  WORKER_POLL_TUNING,
} from '../../queue/queue.constants';
import { CrawlCacheService } from '../crawl-cache.service';
import { LightweightFetchService } from '../lightweight-fetch.service';
import { HeavyAnalyzeConcurrencyGate } from '../heavy-analyze-concurrency.service';
import { AnalyzeWebhookService } from '../analyze-webhook.service';
import {
  BaseCompositeAnalyzeProcessor,
  type CompositeProcessorConfig,
} from '../base-composite-analyze.processor';

@Processor(ANALYZE_STANDARD_QUEUE, {
  concurrency: 1,
  lockDuration: 300_000,
  lockRenewTime: 60_000,
  ...WORKER_POLL_TUNING,
})
export class StandardProcessor extends BaseCompositeAnalyzeProcessor {
  protected readonly logger = new Logger(StandardProcessor.name);
  protected readonly config: CompositeProcessorConfig = {
    endpoint: 'standard',
    deep: false,
    includeMobile: false,
  };

  constructor(
    prisma: PrismaService,
    crawlCache: CrawlCacheService,
    lightweightFetch: LightweightFetchService,
    browserService: BrowserService,
    observationCollector: ObservationCollector,
    lighthouseService: LighthouseService,
    concurrencyGate: HeavyAnalyzeConcurrencyGate,
    screenshotCapture: ScreenshotCaptureService,
    technologyAnalyzer: TechnologyAnalyzerService,
    seoAnalyzer: SeoAnalyzerService,
    securityAnalyzer: SecurityAnalyzerService,
    performanceAnalyzer: PerformanceAnalyzerService,
    businessAnalyzer: BusinessAnalyzerService,
    uxAnalyzer: UxAnalyzerService,
    aiInputBuilder: AiInputBuilderService,
    @Inject(AI_PROVIDER) aiProvider: AIProvider,
    analyzeWebhookService: AnalyzeWebhookService,
  ) {
    super(
      prisma,
      crawlCache,
      lightweightFetch,
      browserService,
      observationCollector,
      lighthouseService,
      concurrencyGate,
      screenshotCapture,
      technologyAnalyzer,
      seoAnalyzer,
      securityAnalyzer,
      performanceAnalyzer,
      businessAnalyzer,
      uxAnalyzer,
      aiInputBuilder,
      aiProvider,
      analyzeWebhookService,
    );
  }
}
