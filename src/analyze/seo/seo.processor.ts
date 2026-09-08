import { Logger } from '@nestjs/common';
import { Processor } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SeoAnalyzerService } from '../../analyzers/seo/seo-analyzer.service';
import { ANALYZE_SEO_QUEUE } from '../../queue/queue.constants';
import { CrawlCacheService } from '../crawl-cache.service';
import { LightweightFetchService } from '../lightweight-fetch.service';
import { AnalyzeWebhookService } from '../analyze-webhook.service';
import { BaseAnalyzeProcessor } from '../base-analyze.processor';
import type { AnalyzeJobData } from '../analyze-job.interface';

const ENDPOINT = 'seo' as const;

@Processor(ANALYZE_SEO_QUEUE, {
  concurrency: 5,
  lockDuration: 120_000,
  lockRenewTime: 30_000,
})
export class SeoProcessor extends BaseAnalyzeProcessor {
  private readonly logger = new Logger(SeoProcessor.name);

  constructor(
    prisma: PrismaService,
    crawlCache: CrawlCacheService,
    lightweightFetch: LightweightFetchService,
    private readonly seoAnalyzer: SeoAnalyzerService,
    private readonly analyzeWebhookService: AnalyzeWebhookService,
  ) {
    super(prisma, crawlCache, lightweightFetch);
  }

  async process(job: Job<AnalyzeJobData>): Promise<void> {
    const { analyzeJobId, url } = job.data;
    let stage = 'resolving_observations';

    try {
      await this.markRunning(analyzeJobId, stage);
      const resolved = await this.resolveObservations(job.data, false);
      const rawObservations = this.toRawObservations(resolved);

      stage = 'analyzing';
      await this.updateStage(analyzeJobId, stage);
      const result = await this.seoAnalyzer.analyze(rawObservations, {
        deep: false,
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

      this.logger.log(`Completed ${ENDPOINT} analyze job ${analyzeJobId}`);
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
