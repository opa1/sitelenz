import { Inject, Logger } from '@nestjs/common';
import { Processor } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AiInputBuilderService } from '../../ai/ai-input-builder.service';
import { AI_PROVIDER } from '../../ai/ai-provider.interface';
import type { AIProvider } from '../../ai/ai-provider.interface';
import { ANALYZE_AI_SUMMARY_QUEUE } from '../../queue/queue.constants';
import { CrawlCacheService } from '../crawl-cache.service';
import { LightweightFetchService } from '../lightweight-fetch.service';
import { AnalyzeWebhookService } from '../analyze-webhook.service';
import { BaseAnalyzeProcessor } from '../base-analyze.processor';
import type { AnalyzeJobData } from '../analyze-job.interface';

const ENDPOINT = 'ai-summary' as const;

// No browser, no crawl, no CrawlCacheService interaction - just extends the
// plain BaseAnalyzeProcessor (not BaseHeavyAnalyzeProcessor). Short lock:
// this is a single LLM round trip, not a Playwright session.
@Processor(ANALYZE_AI_SUMMARY_QUEUE, {
  concurrency: 5,
  lockDuration: 60_000,
  lockRenewTime: 20_000,
})
export class AiSummaryProcessor extends BaseAnalyzeProcessor {
  private readonly logger = new Logger(AiSummaryProcessor.name);

  constructor(
    prisma: PrismaService,
    crawlCache: CrawlCacheService,
    lightweightFetch: LightweightFetchService,
    private readonly aiInputBuilder: AiInputBuilderService,
    @Inject(AI_PROVIDER) private readonly aiProvider: AIProvider,
    private readonly analyzeWebhookService: AnalyzeWebhookService,
  ) {
    super(prisma, crawlCache, lightweightFetch);
  }

  async process(job: Job<AnalyzeJobData>): Promise<void> {
    const { analyzeJobId, url, findings } = job.data;
    let stage = 'building_ai_input';

    try {
      await this.markRunning(analyzeJobId, stage);
      const condensedInput = this.aiInputBuilder.buildFromFindings(findings ?? {});

      stage = 'ai_analysis';
      await this.updateStage(analyzeJobId, stage);
      const aiResult = await this.aiProvider.interpret(condensedInput, {
        deep: false,
      });

      stage = 'storing_results';
      await this.updateStage(analyzeJobId, stage);
      const result = {
        url,
        aiResult,
        interpretedAt: new Date().toISOString(),
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

      this.logger.log(`Completed ${ENDPOINT} analyze job ${analyzeJobId}`);
    } catch (error) {
      const err = error as Error & { code?: string };
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.error(`${ENDPOINT} analyze job failed`, {
        analyzeJobId,
        url,
        stage,
        error: errorMessage,
      });

      await this.failJob(analyzeJobId, err, stage).catch((updateError: Error) => {
        this.logger.error(
          `Failed to mark analyze job ${analyzeJobId} as failed: ${updateError.message}`,
        );
      });

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
