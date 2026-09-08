import { Logger } from '@nestjs/common';
import { Processor } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BrowserService } from '../../common/browser/browser.service';
import { ObservationCollector } from '../../common/browser/observation-collector.service';
import { LighthouseService } from '../../common/browser/lighthouse.service';
import { UxAnalyzerService } from '../../analyzers/ux/ux-analyzer.service';
import { ANALYZE_UX_ACCESSIBILITY_QUEUE } from '../../queue/queue.constants';
import { CrawlCacheService } from '../crawl-cache.service';
import { LightweightFetchService } from '../lightweight-fetch.service';
import { HeavyAnalyzeConcurrencyGate } from '../heavy-analyze-concurrency.service';
import { AnalyzeWebhookService } from '../analyze-webhook.service';
import { BaseHeavyAnalyzeProcessor } from '../base-heavy-analyze.processor';
import type { AnalyzeJobData } from '../analyze-job.interface';

const ENDPOINT = 'ux-accessibility' as const;

@Processor(ANALYZE_UX_ACCESSIBILITY_QUEUE, {
  concurrency: 1,
  lockDuration: 300_000,
  lockRenewTime: 60_000,
})
export class UxAccessibilityProcessor extends BaseHeavyAnalyzeProcessor {
  private readonly logger = new Logger(UxAccessibilityProcessor.name);

  constructor(
    prisma: PrismaService,
    crawlCache: CrawlCacheService,
    lightweightFetch: LightweightFetchService,
    browserService: BrowserService,
    observationCollector: ObservationCollector,
    lighthouseService: LighthouseService,
    concurrencyGate: HeavyAnalyzeConcurrencyGate,
    private readonly uxAnalyzer: UxAnalyzerService,
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
    let stage = 'resolving_observations';

    try {
      await this.markRunning(analyzeJobId, stage);
      const resolved = await this.resolveFullObservations(job.data);

      stage = 'analyzing';
      await this.updateStage(analyzeJobId, stage);
      // deep: true - mobile UX and reading-experience analysis via
      // Lighthouse accessibility audits.
      const result = await this.uxAnalyzer.analyze(resolved.observations, {
        deep: true,
      });

      stage = 'storing_results';
      await this.updateStage(analyzeJobId, stage);
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
