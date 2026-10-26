import { Logger } from '@nestjs/common';
import { Processor } from '@nestjs/bullmq';
import { DelayedError, type Job } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BrowserService } from '../../common/browser/browser.service';
import { ObservationCollector } from '../../common/browser/observation-collector.service';
import { LighthouseService } from '../../common/browser/lighthouse.service';
import { PerformanceAnalyzerService } from '../../analyzers/performance/performance-analyzer.service';
import {
  ANALYZE_PERFORMANCE_QUEUE,
  WORKER_POLL_TUNING,
} from '../../queue/queue.constants';
import { CrawlCacheService } from '../crawl-cache.service';
import { LightweightFetchService } from '../lightweight-fetch.service';
import { HeavyAnalyzeConcurrencyGate } from '../heavy-analyze-concurrency.service';
import { AnalyzeWebhookService } from '../analyze-webhook.service';
import { BaseHeavyAnalyzeProcessor } from '../base-heavy-analyze.processor';
import type { AnalyzeJobData } from '../analyze-job.interface';

const ENDPOINT = 'performance' as const;

// Browser sessions are slow (full Playwright crawl + Lighthouse run) - a
// 5-minute lock (renewed every minute) so BullMQ doesn't treat a still-
// running job as stalled and hand it to another worker mid-run.
@Processor(ANALYZE_PERFORMANCE_QUEUE, {
  concurrency: 1,
  lockDuration: 300_000,
  lockRenewTime: 60_000,
  ...WORKER_POLL_TUNING,
})
export class PerformanceProcessor extends BaseHeavyAnalyzeProcessor {
  private readonly logger = new Logger(PerformanceProcessor.name);

  constructor(
    prisma: PrismaService,
    crawlCache: CrawlCacheService,
    lightweightFetch: LightweightFetchService,
    browserService: BrowserService,
    observationCollector: ObservationCollector,
    lighthouseService: LighthouseService,
    concurrencyGate: HeavyAnalyzeConcurrencyGate,
    private readonly performanceAnalyzer: PerformanceAnalyzerService,
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

  async process(job: Job<AnalyzeJobData>, token?: string): Promise<void> {
    const { analyzeJobId, url } = job.data;
    let stage = 'waiting_for_capacity';
    let holdsSlot = false;

    try {
      await this.acquireSlotOrDelay(job, token);
      holdsSlot = true;

      stage = 'resolving_observations';
      await this.markRunning(analyzeJobId, stage);
      const resolved = await this.resolveFullObservations(job.data);

      stage = 'analyzing';
      await this.updateStage(analyzeJobId, stage);
      // deep: true - full resource inventory and third-party analysis.
      const result = await this.performanceAnalyzer.analyze(
        resolved.observations,
        {
          deep: true,
        },
      );

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
      // Job was put back in the queue to wait for a slot - not a failure.
      if (error instanceof DelayedError) throw error;

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
    } finally {
      if (holdsSlot) this.concurrencyGate.release();
    }
  }
}
