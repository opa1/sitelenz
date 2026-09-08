import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../common/prisma/prisma.service';
import { BrowserService } from '../common/browser/browser.service';
import { ObservationCollector } from '../common/browser/observation-collector.service';
import { LighthouseService } from '../common/browser/lighthouse.service';
import { ScreenshotCaptureService } from '../storage/screenshot-capture.service';
import { TechnologyAnalyzerService } from '../analyzers/technology/technology-analyzer.service';
import { SeoAnalyzerService } from '../analyzers/seo/seo-analyzer.service';
import { SecurityAnalyzerService } from '../analyzers/security/security-analyzer.service';
import { PerformanceAnalyzerService } from '../analyzers/performance/performance-analyzer.service';
import { BusinessAnalyzerService } from '../analyzers/business/business-analyzer.service';
import { UxAnalyzerService } from '../analyzers/ux/ux-analyzer.service';
import { AiInputBuilderService } from '../ai/ai-input-builder.service';
import { AI_PROVIDER } from '../ai/ai-provider.interface';
import type { AIProvider } from '../ai/ai-provider.interface';
import { CrawlCacheService } from './crawl-cache.service';
import { LightweightFetchService } from './lightweight-fetch.service';
import { HeavyAnalyzeConcurrencyGate } from './heavy-analyze-concurrency.service';
import { AnalyzeWebhookService } from './analyze-webhook.service';
import { BaseHeavyAnalyzeProcessor } from './base-heavy-analyze.processor';
import type { AnalyzeJobData } from './analyze-job.interface';
import type { CompositeAnalyzeResult } from './composite-analyze-result.interface';
import type { ScreenshotEntry } from './screenshots/screenshots-result.interface';

export interface CompositeProcessorConfig {
  endpoint: 'standard' | 'full';
  deep: boolean;
  includeMobile: boolean;
}

/**
 * Shared pipeline for the two composite endpoints (standard/full): resolve
 * a full crawl, screenshot(s), all six analyzers, an AI summary, then
 * assemble+store the combined result. Standard and full differ only in
 * `deep`/`includeMobile`/`endpoint` (set via the `config` each subclass
 * provides) - see standard.processor.ts and full.processor.ts.
 */
export abstract class BaseCompositeAnalyzeProcessor extends BaseHeavyAnalyzeProcessor {
  protected abstract readonly logger: Logger;
  protected abstract readonly config: CompositeProcessorConfig;

  constructor(
    prisma: PrismaService,
    crawlCache: CrawlCacheService,
    lightweightFetch: LightweightFetchService,
    browserService: BrowserService,
    observationCollector: ObservationCollector,
    lighthouseService: LighthouseService,
    concurrencyGate: HeavyAnalyzeConcurrencyGate,
    protected readonly screenshotCapture: ScreenshotCaptureService,
    protected readonly technologyAnalyzer: TechnologyAnalyzerService,
    protected readonly seoAnalyzer: SeoAnalyzerService,
    protected readonly securityAnalyzer: SecurityAnalyzerService,
    protected readonly performanceAnalyzer: PerformanceAnalyzerService,
    protected readonly businessAnalyzer: BusinessAnalyzerService,
    protected readonly uxAnalyzer: UxAnalyzerService,
    protected readonly aiInputBuilder: AiInputBuilderService,
    @Inject(AI_PROVIDER) protected readonly aiProvider: AIProvider,
    protected readonly analyzeWebhookService: AnalyzeWebhookService,
  ) {
    super(
      prisma,
      crawlCache,
      lightweightFetch,
      browserService,
      observationCollector,
      lighthouseService,
      concurrencyGate,
    );
  }

  async process(job: Job<AnalyzeJobData>): Promise<void> {
    const { analyzeJobId, url } = job.data;
    const { endpoint, deep, includeMobile } = this.config;
    const startedAt = Date.now();
    let stage = 'resolving_observations';

    try {
      await this.markRunning(analyzeJobId, stage);
      const resolved = await this.resolveFullObservations(job.data, {
        keepContextOpen: true,
      });
      const observations = resolved.observations;

      stage = 'taking_screenshots';
      await this.updateStage(analyzeJobId, stage);

      // Fault-tolerant like the standalone screenshots endpoint: a capture
      // timing out (real sites with continuous animations/video backgrounds
      // can hang Playwright's screenshot stability wait - see
      // ScreenshotCaptureService's `animations: 'disabled'`) shouldn't
      // discard an already-completed crawl and, later, all six analyzers.
      let desktopEntry: ScreenshotEntry | null = null;
      let mobileEntry: ScreenshotEntry | null = null;

      const onScreenshotError =
        (type: 'desktop' | 'mobile') => (error: Error) => {
          this.logger.error(
            `${type === 'desktop' ? 'Desktop' : 'Mobile'} screenshot failed for analyze job ${analyzeJobId}: ${error.message}`,
          );
          return null;
        };

      if (!resolved.cacheHit && resolved.context && resolved.releaseContext) {
        try {
          desktopEntry = await this.screenshotCapture
            .capture(
              resolved.context,
              observations.url,
              analyzeJobId,
              'desktop',
            )
            .catch(onScreenshotError('desktop'));
          if (includeMobile) {
            mobileEntry = await this.withGatedContext(
              () => this.browserService.acquireMobileContext(),
              (context) =>
                this.screenshotCapture.capture(
                  context,
                  observations.url,
                  analyzeJobId,
                  'mobile',
                ),
            ).catch(onScreenshotError('mobile'));
          }
        } finally {
          await resolved.releaseContext();
        }
      } else {
        // Cache hit - no live page from resolveFullObservations. Acquire a
        // fresh desktop context just for the screenshot.
        desktopEntry = await this.withGatedContext(
          () => this.browserService.acquireContext(),
          (context) =>
            this.screenshotCapture.capture(
              context,
              observations.url,
              analyzeJobId,
              'desktop',
            ),
        ).catch(onScreenshotError('desktop'));
        if (includeMobile) {
          mobileEntry = await this.withGatedContext(
            () => this.browserService.acquireMobileContext(),
            (context) =>
              this.screenshotCapture.capture(
                context,
                observations.url,
                analyzeJobId,
                'mobile',
              ),
          ).catch(onScreenshotError('mobile'));
        }
      }

      stage = 'analyzing';
      await this.updateStage(analyzeJobId, stage);
      const analyzerOptions = { deep };
      // Sequential, not parallel - a later analyzer may eventually want an
      // earlier one's output as context (matches the old AnalysisProcessor).
      const technologyResult = await this.technologyAnalyzer.analyze(
        observations,
        analyzerOptions,
      );
      const seoResult = await this.seoAnalyzer.analyze(
        observations,
        analyzerOptions,
      );
      const securityResult = await this.securityAnalyzer.analyze(
        observations,
        analyzerOptions,
      );
      const performanceResult = await this.performanceAnalyzer.analyze(
        observations,
        analyzerOptions,
      );
      const businessResult = await this.businessAnalyzer.analyze(
        observations,
        analyzerOptions,
      );
      const uxResult = await this.uxAnalyzer.analyze(
        observations,
        analyzerOptions,
      );

      stage = 'ai_analysis';
      await this.updateStage(analyzeJobId, stage);
      const condensedInput = this.aiInputBuilder.build(
        {
          technology: technologyResult,
          seo: seoResult,
          security: securityResult,
          performance: performanceResult,
          business: businessResult,
          ux: uxResult,
        },
        { deep },
      );
      const aiResult = await this.aiProvider.interpret(condensedInput, {
        deep,
      });

      stage = 'storing_results';
      await this.updateStage(analyzeJobId, stage);
      const result: CompositeAnalyzeResult = {
        analyzeJobId,
        url,
        endpoint,
        website: {
          finalUrl: observations.url,
          statusCode: observations.statusCode,
          redirectChain: observations.redirectChain,
        },
        technology: technologyResult,
        seo: seoResult,
        security: securityResult,
        performance: performanceResult,
        business: businessResult,
        ux: uxResult,
        ai: aiResult,
        screenshots: includeMobile
          ? { desktop: desktopEntry, mobile: mobileEntry }
          : { desktop: desktopEntry },
        metadata: {
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
          cacheHit: resolved.cacheHit,
        },
      };
      await this.completeJob(analyzeJobId, result);

      stage = 'sending_webhook';
      await this.updateStage(analyzeJobId, stage);
      await this.analyzeWebhookService
        .deliver(analyzeJobId, 'analyze.completed', {
          event: 'analyze.completed',
          analyzeJobId,
          endpoint,
          status: 'completed',
          resultUrl: `/v1/analyze/${endpoint}/${analyzeJobId}/result`,
        })
        .catch((error: Error) => {
          this.logger.error(
            `Failed to enqueue completion webhook for analyze job ${analyzeJobId}: ${error.message}`,
          );
        });

      this.logger.log(
        `Completed ${endpoint} analyze job ${analyzeJobId} (cacheHit=${resolved.cacheHit})`,
      );
    } catch (error) {
      const err = error as Error & { code?: string };
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(`${endpoint} analyze job failed`, {
        analyzeJobId,
        url,
        stage,
        error: errorMessage,
      });

      await this.failJob(analyzeJobId, err, stage).catch(
        (updateError: Error) => {
          this.logger.error(
            `Failed to mark analyze job ${analyzeJobId} as failed: ${updateError.message}`,
          );
        },
      );

      await this.analyzeWebhookService
        .deliver(analyzeJobId, 'analyze.failed', {
          event: 'analyze.failed',
          analyzeJobId,
          endpoint,
          status: 'failed',
          error: { code: err.code ?? 'UNKNOWN_ERROR', message: errorMessage },
        })
        .catch((webhookError: Error) => {
          this.logger.error(
            `Failed to enqueue failure webhook for analyze job ${analyzeJobId}: ${webhookError.message}`,
          );
        });
    }
  }
}
