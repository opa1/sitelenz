import { Inject, Logger } from '@nestjs/common';
import { Processor } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BrowserService } from '../../common/browser/browser.service';
import { ObservationCollector } from '../../common/browser/observation-collector.service';
import { LighthouseService } from '../../common/browser/lighthouse.service';
import { TechnologyAnalyzerService } from '../../analyzers/technology/technology-analyzer.service';
import { SeoAnalyzerService } from '../../analyzers/seo/seo-analyzer.service';
import { SecurityAnalyzerService } from '../../analyzers/security/security-analyzer.service';
import { PerformanceAnalyzerService } from '../../analyzers/performance/performance-analyzer.service';
import { BusinessAnalyzerService } from '../../analyzers/business/business-analyzer.service';
import { UxAnalyzerService } from '../../analyzers/ux/ux-analyzer.service';
import { AiInputBuilderService } from '../../ai/ai-input-builder.service';
import { AI_PROVIDER } from '../../ai/ai-provider.interface';
import type { AIProvider } from '../../ai/ai-provider.interface';
import { ANALYZE_AI_SUMMARY_QUEUE } from '../../queue/queue.constants';
import { CrawlCacheService } from '../crawl-cache.service';
import { LightweightFetchService } from '../lightweight-fetch.service';
import { HeavyAnalyzeConcurrencyGate } from '../heavy-analyze-concurrency.service';
import { AnalyzeWebhookService } from '../analyze-webhook.service';
import { BaseHeavyAnalyzeProcessor } from '../base-heavy-analyze.processor';
import type { AnalyzeJobData } from '../analyze-job.interface';
import type { AiSummaryAnalyzeResult } from './ai-summary-result.interface';

const ENDPOINT = 'ai-summary' as const;

// Same full crawl + all-six-analyzers pipeline as standard, minus the
// screenshot step, returning only the AI interpretation - hence
// BaseHeavyAnalyzeProcessor (Playwright crawl), not the plain
// BaseAnalyzeProcessor the lightweight endpoints use.
@Processor(ANALYZE_AI_SUMMARY_QUEUE, {
  concurrency: 1,
  lockDuration: 300_000,
  lockRenewTime: 60_000,
})
export class AiSummaryProcessor extends BaseHeavyAnalyzeProcessor {
  private readonly logger = new Logger(AiSummaryProcessor.name);

  constructor(
    prisma: PrismaService,
    crawlCache: CrawlCacheService,
    lightweightFetch: LightweightFetchService,
    browserService: BrowserService,
    observationCollector: ObservationCollector,
    lighthouseService: LighthouseService,
    concurrencyGate: HeavyAnalyzeConcurrencyGate,
    private readonly technologyAnalyzer: TechnologyAnalyzerService,
    private readonly seoAnalyzer: SeoAnalyzerService,
    private readonly securityAnalyzer: SecurityAnalyzerService,
    private readonly performanceAnalyzer: PerformanceAnalyzerService,
    private readonly businessAnalyzer: BusinessAnalyzerService,
    private readonly uxAnalyzer: UxAnalyzerService,
    private readonly aiInputBuilder: AiInputBuilderService,
    @Inject(AI_PROVIDER) private readonly aiProvider: AIProvider,
    private readonly analyzeWebhookService: AnalyzeWebhookService,
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
    const startedAt = Date.now();
    let stage = 'resolving_observations';

    try {
      await this.markRunning(analyzeJobId, stage);
      const resolved = await this.resolveFullObservations(job.data);
      const observations = resolved.observations;

      stage = 'analyzing';
      await this.updateStage(analyzeJobId, stage);
      const analyzerOptions = { deep: false };
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
        { deep: false },
      );
      const aiResult = await this.aiProvider.interpret(condensedInput, {
        deep: false,
      });

      stage = 'storing_results';
      await this.updateStage(analyzeJobId, stage);
      const result: AiSummaryAnalyzeResult = {
        url,
        ai: aiResult,
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
          endpoint: ENDPOINT,
          status: 'completed',
          resultUrl: `/v1/analyze/${ENDPOINT}/${analyzeJobId}/result`,
        })
        .catch((error: Error) => {
          this.logger.error(
            `Failed to enqueue completion webhook for analyze job ${analyzeJobId}: ${error.message}`,
          );
        });

      this.logger.log(
        `Completed ${ENDPOINT} analyze job ${analyzeJobId} (cacheHit=${resolved.cacheHit})`,
      );
    } catch (error) {
      const err = error as Error & { code?: string };
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.error(`${ENDPOINT} analyze job failed`, {
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
          endpoint: ENDPOINT,
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
