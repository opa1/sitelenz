import type { BrowserContext } from 'playwright';
import { CrawlType, type Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { BrowserService } from '../common/browser/browser.service';
import { ObservationCollector } from '../common/browser/observation-collector.service';
import { LighthouseService } from '../common/browser/lighthouse.service';
import type { RawObservations } from '../common/browser/raw-observations.interface';
import { normalizeUrl } from '../common/utils/normalize-url.util';
import { CrawlCacheService } from './crawl-cache.service';
import { LightweightFetchService } from './lightweight-fetch.service';
import { HeavyAnalyzeConcurrencyGate } from './heavy-analyze-concurrency.service';
import { BaseAnalyzeProcessor } from './base-analyze.processor';
import type { AnalyzeJobData } from './analyze-job.interface';

export interface ResolvedFullObservations {
  observations: RawObservations;
  crawlType: 'full';
  cacheHit: boolean;
  /**
   * Only set on a fresh (non-cache-hit) crawl when `keepContextOpen: true`
   * was requested - the screenshots processor needs a live browser context
   * to take screenshots from, not just the stored observations. Close it via
   * `releaseContext()` (not `context.close()` directly), which also frees
   * the HeavyAnalyzeConcurrencyGate slot this context is holding.
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
   * Runs `fn` with a browser context whose lifetime it fully owns: acquires
   * a HeavyAnalyzeConcurrencyGate slot, acquires the context, runs `fn`,
   * then always closes the context and releases the slot together. Use this
   * whenever the context doesn't need to outlive the call (i.e. everywhere
   * except resolveFullObservations's `keepContextOpen` path).
   */
  protected async withGatedContext<T>(
    acquireContext: () => Promise<BrowserContext>,
    fn: (context: BrowserContext) => Promise<T>,
  ): Promise<T> {
    this.concurrencyGate.acquire();
    let context: BrowserContext;
    try {
      context = await acquireContext();
    } catch (error) {
      this.concurrencyGate.release();
      throw this.normalizeBrowserError(error);
    }
    try {
      return await fn(context);
    } catch (error) {
      throw this.normalizeBrowserError(error);
    } finally {
      await context.close().catch(() => undefined);
      this.concurrencyGate.release();
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

    // keepContextOpen: the gate slot and context deliberately outlive this
    // call - released together later via releaseContext(), not in a finally
    // here.
    this.concurrencyGate.acquire();
    let context: BrowserContext;
    try {
      context = await this.browserService.acquireContext();
    } catch (error) {
      this.concurrencyGate.release();
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
          this.concurrencyGate.release();
        },
      };
    } catch (error) {
      await context.close().catch(() => undefined);
      this.concurrencyGate.release();
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
