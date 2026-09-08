import { Logger } from '@nestjs/common';
import { Processor } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { BrowserService } from '../../common/browser/browser.service';
import { ObservationCollector } from '../../common/browser/observation-collector.service';
import { LighthouseService } from '../../common/browser/lighthouse.service';
import { ScreenshotCaptureService } from '../../storage/screenshot-capture.service';
import { ANALYZE_SCREENSHOTS_QUEUE } from '../../queue/queue.constants';
import { CrawlCacheService } from '../crawl-cache.service';
import { LightweightFetchService } from '../lightweight-fetch.service';
import { HeavyAnalyzeConcurrencyGate } from '../heavy-analyze-concurrency.service';
import { AnalyzeWebhookService } from '../analyze-webhook.service';
import {
  BaseHeavyAnalyzeProcessor,
  type ResolvedFullObservations,
} from '../base-heavy-analyze.processor';
import type { AnalyzeJobData } from '../analyze-job.interface';
import type {
  ScreenshotEntry,
  ScreenshotsAnalyzeResult,
} from './screenshots-result.interface';

const ENDPOINT = 'screenshots' as const;

@Processor(ANALYZE_SCREENSHOTS_QUEUE, {
  concurrency: 1,
  lockDuration: 300_000,
  lockRenewTime: 60_000,
})
export class ScreenshotsProcessor extends BaseHeavyAnalyzeProcessor {
  private readonly logger = new Logger(ScreenshotsProcessor.name);

  constructor(
    prisma: PrismaService,
    crawlCache: CrawlCacheService,
    lightweightFetch: LightweightFetchService,
    browserService: BrowserService,
    observationCollector: ObservationCollector,
    lighthouseService: LighthouseService,
    concurrencyGate: HeavyAnalyzeConcurrencyGate,
    private readonly screenshotCapture: ScreenshotCaptureService,
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
      // keepContextOpen: on a fresh crawl (no cached full observation), stay
      // on the exact context/session the crawl just ran in for the desktop
      // shot instead of paying for a second context creation.
      const resolved = await this.resolveFullObservations(job.data, {
        keepContextOpen: true,
      });
      const pageUrl = resolved.observations.url;

      stage = 'taking_screenshots';
      await this.updateStage(analyzeJobId, stage);

      const desktopEntry = await this.captureDesktopEntry(
        resolved,
        analyzeJobId,
      );
      const mobileEntry = await this.captureMobileEntry(pageUrl, analyzeJobId);

      stage = 'storing_results';
      await this.updateStage(analyzeJobId, stage);
      const result: ScreenshotsAnalyzeResult = {
        desktop: desktopEntry,
        mobile: mobileEntry,
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
        `Completed ${ENDPOINT} analyze job ${analyzeJobId} (cacheHit=${resolved.cacheHit}, desktop=${!!desktopEntry}, mobile=${!!mobileEntry})`,
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

  /**
   * Desktop capture is fault-tolerant like mobile (returns null rather than
   * failing the whole job - see captureMobileEntry) but has two different
   * context sources depending on how resolveFullObservations resolved:
   *  - fresh crawl (cacheHit: false): reuse its still-open desktop context,
   *    released via releaseContext() once the shot is taken.
   *  - cache hit (cacheHit: true): no live page exists from this call at
   *    all, so acquire a fresh desktop context just for the screenshot.
   */
  private async captureDesktopEntry(
    resolved: ResolvedFullObservations,
    analyzeJobId: string,
  ): Promise<ScreenshotEntry | null> {
    const pageUrl = resolved.observations.url;

    if (!resolved.cacheHit && resolved.context && resolved.releaseContext) {
      const context = resolved.context;
      try {
        return await this.screenshotCapture.capture(
          context,
          pageUrl,
          analyzeJobId,
          'desktop',
        );
      } catch (error) {
        this.logger.error(
          `Desktop screenshot failed for analyze job ${analyzeJobId}: ${(error as Error).message}`,
        );
        return null;
      } finally {
        await resolved.releaseContext();
      }
    }

    try {
      return await this.withGatedContext(
        () => this.browserService.acquireContext(),
        (context) =>
          this.screenshotCapture.capture(
            context,
            pageUrl,
            analyzeJobId,
            'desktop',
          ),
      );
    } catch (error) {
      this.logger.error(
        `Desktop screenshot failed for analyze job ${analyzeJobId}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  private async captureMobileEntry(
    pageUrl: string,
    analyzeJobId: string,
  ): Promise<ScreenshotEntry | null> {
    try {
      return await this.withGatedContext(
        () => this.browserService.acquireMobileContext(),
        (context) =>
          this.screenshotCapture.capture(
            context,
            pageUrl,
            analyzeJobId,
            'mobile',
          ),
      );
    } catch (error) {
      this.logger.error(
        `Mobile screenshot failed for analyze job ${analyzeJobId}: ${(error as Error).message}`,
      );
      return null;
    }
  }
}
