import type { BrowserContext } from 'playwright';
import { DelayedError, type Job } from 'bullmq';
import { CrawlType, type Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { BrowserService } from '../common/browser/browser.service';
import { ObservationCollector } from '../common/browser/observation-collector.service';
import { LighthouseService } from '../common/browser/lighthouse.service';
import type { RawObservations } from '../common/browser/raw-observations.interface';
import { normalizeUrl } from '../common/utils/normalize-url.util';
import { CrawlCacheService } from './crawl-cache.service';
import { LightweightFetchService } from './lightweight-fetch.service';
import {
  CapacityTimeoutError,
  HeavyAnalyzeConcurrencyGate,
} from './heavy-analyze-concurrency.service';
import { BaseAnalyzeProcessor } from './base-analyze.processor';
import type { AnalyzeJobData } from './analyze-job.interface';

/** progressStage a queued job shows while it waits for a free browser slot. */
export const WAITING_FOR_CAPACITY_STAGE = 'waiting_for_capacity';
/** How long a job waits before checking for a free slot again. */
const CAPACITY_RETRY_DELAY_MS = 5_000;

export interface ResolvedFullObservations {
  observations: RawObservations;
  crawlType: 'full';
  cacheHit: boolean;
  /**
   * Only set on a fresh (non-cache-hit) crawl when `keepContextOpen: true`
   * was requested - the screenshots processor needs a live browser context
   * to take screenshots from, not just the stored observations. Close it via
   * `releaseContext()`.
   */
  context?: BrowserContext;
  releaseContext?: () => Promise<void>;
}

/**
 * Adds the Playwright full-crawl path to BaseAnalyzeProcessor - a separate
 * subclass rather than adding these dependencies directly to
 * BaseAnalyzeProcessor's own constructor, so the four existing lightweight
 * processors (which never touch a browser) don't have to grow constructor
 * params they'd never use.
 */
export abstract class BaseHeavyAnalyzeProcessor extends BaseAnalyzeProcessor {
  constructor(
    prisma: PrismaService,
    crawlCache: CrawlCacheService,
    lightweightFetch: LightweightFetchService,
    protected readonly browserService: BrowserService,
    protected readonly observationCollector: ObservationCollector,
    protected readonly lighthouseService: LighthouseService,
    protected readonly concurrencyGate: HeavyAnalyzeConcurrencyGate,
  ) {
    super(prisma, crawlCache, lightweightFetch);
  }

  /**
   * Claims this job's HeavyAnalyzeConcurrencyGate slot, or - when all slots
   * are taken - puts the job back in the queue to try again shortly. Call it
   * first in `process()`, before anything that marks the job running, and
   * release the slot in a `finally` once it returns.
   *
   * Never fails the job for lack of capacity (clients have already paid by
   * the time it runs) and never holds the BullMQ lock while waiting:
   * `moveToDelayed` hands the job back to the delayed set and the
   * DelayedError tells the worker not to complete or fail it. moveToDelayed
   * skips the attempt counter, so waiting never counts as a retry, and the
   * analysis timeout only starts once the job actually crawls. The DB status
   * stays `queued`; only progressStage changes, so polling clients can see
   * why the job hasn't started.
   *
   * Throws CapacityTimeoutError only once the job has waited longer than
   * MAX_CAPACITY_WAIT_MS in total, which the caller's catch turns into a
   * normal failed job + analyze.failed webhook (retryable for free).
   */
  protected async acquireSlotOrDelay(
    job: Job<AnalyzeJobData>,
    token: string | undefined,
  ): Promise<void> {
    if (this.concurrencyGate.tryAcquire()) return;

    const { analyzeJobId, endpoint } = job.data;
    const now = Date.now();
    const firstWait = job.data.capacityWaitStartedAt === undefined;
    const waitStartedAt = job.data.capacityWaitStartedAt ?? now;
    const waitedMs = now - waitStartedAt;
    if (waitedMs >= this.concurrencyGate.maxWaitMs) {
      throw new CapacityTimeoutError(endpoint, analyzeJobId, waitedMs);
    }

    if (firstWait) {
      await job.updateData({
        ...job.data,
        capacityWaitStartedAt: waitStartedAt,
      });
      await this.updateStage(analyzeJobId, WAITING_FOR_CAPACITY_STAGE);
    }
    await job.moveToDelayed(now + CAPACITY_RETRY_DELAY_MS, token);
    throw new DelayedError();
  }

  /**
   * Runs `fn` with a browser context it fully owns: acquires the context,
   * runs `fn`, then always closes it. The caller already holds the job's
   * gate slot (see acquireSlotOrDelay), so this never touches the gate.
   */
  protected async withGatedContext<T>(
    acquireContext: () => Promise<BrowserContext>,
    fn: (context: BrowserContext) => Promise<T>,
  ): Promise<T> {
    let context: BrowserContext;
    try {
      context = await acquireContext();
    } catch (error) {
      throw this.normalizeBrowserError(error);
    }
    try {
      return await fn(context);
    } catch (error) {
      throw this.normalizeBrowserError(error);
    } finally {
      await context.close().catch(() => undefined);
    }
  }

  /**
   * Full (Playwright) crawl counterpart to the lightweight
   * `resolveObservations` - a cached `full` observation always satisfies a
   * full request (CrawlCacheService only ever returns an exact `full` match
   * for a `full` lookup), so this never needs the lightweight-vs-full
   * adaptation `toRawObservations` does.
   */
  protected async resolveFullObservations(
    job: AnalyzeJobData,
    options: { keepContextOpen?: boolean } = {},
  ): Promise<ResolvedFullObservations> {
    const normalizedUrl = normalizeUrl(job.url);

    const cached = await this.crawlCache.getFreshObservation(
      normalizedUrl,
      'full',
    );
    if (cached) {
      return {
        observations: cached.rawObservations as unknown as RawObservations,
        crawlType: 'full',
        cacheHit: true,
      };
    }

    const crawl = async (context: BrowserContext): Promise<RawObservations> => {
      const observations = await this.observationCollector.collect(
        context,
        job.url,
      );
      observations.lighthouseResult = await this.lighthouseService.run(
        observations.url,
      );
      await this.crawlCache.storeCrawlObservation({
        url: job.url,
        normalizedUrl,
        rawObservations: observations as unknown as Prisma.InputJsonValue,
        crawlType: CrawlType.full,
      });
      return observations;
    };

    if (!options.keepContextOpen) {
      const observations = await this.withGatedContext(
        () => this.browserService.acquireContext(),
        crawl,
      );
      return { observations, crawlType: 'full', cacheHit: false };
    }

    // keepContextOpen: the context deliberately outlives this call - closed
    // later via releaseContext(), not in a finally here.
    let context: BrowserContext;
    try {
      context = await this.browserService.acquireContext();
    } catch (error) {
      throw this.normalizeBrowserError(error);
    }
    try {
      const observations = await crawl(context);
      return {
        observations,
        crawlType: 'full',
        cacheHit: false,
        context,
        releaseContext: async () => {
          await context.close().catch(() => undefined);
        },
      };
    } catch (error) {
      await context.close().catch(() => undefined);
      throw this.normalizeBrowserError(error);
    }
  }

  /**
   * ObservationCollector already throws typed errors with a stable `.code`
   * (SSRF_DETECTED/ANALYSIS_TIMEOUT/WEBSITE_UNAVAILABLE - see crawl.errors.ts)
   * which pass through unchanged; anything else (e.g. BrowserService failing
   * to launch/acquire a context) is labeled BROWSER_FAILURE so failJob and
   * the failure webhook always get a stable code instead of 'UNKNOWN_ERROR'.
   */
  protected normalizeBrowserError(error: unknown): Error & { code: string } {
    if (
      error instanceof Error &&
      'code' in error &&
      typeof (error as { code?: unknown }).code === 'string'
    ) {
      return error as Error & { code: string };
    }
    const err = new Error(
      error instanceof Error ? error.message : String(error),
    ) as Error & { code: string };
    err.code = 'BROWSER_FAILURE';
    return err;
  }
}
