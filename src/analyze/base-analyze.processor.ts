import { WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { AnalyzeJobStatus, CrawlType, type Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import type { RawObservations } from '../common/browser/raw-observations.interface';
import { normalizeUrl } from '../common/utils/normalize-url.util';
import { sanitizeForJsonb } from '../common/utils/json-sanitize.util';
import { CrawlCacheService } from './crawl-cache.service';
import { LightweightFetchService } from './lightweight-fetch.service';
import type { LightweightObservations } from './lightweight-observations.interface';
import { toRawObservationsShape } from './lightweight-to-raw-observations.util';
import type { AnalyzeJobData } from './analyze-job.interface';

export interface ResolvedObservations {
  observations: LightweightObservations | RawObservations;
  crawlType: 'lightweight' | 'full';
  cacheHit: boolean;
}

/**
 * Shared helper a concrete `@Processor` class extends - not itself a
 * BullMQ processor (no `@Processor()` decorator, no queue). Bundles the
 * crawl-cache/fetch logic and AnalyzeJob status transitions common to every
 * lightweight analyze endpoint.
 */
export abstract class BaseAnalyzeProcessor extends WorkerHost {
  constructor(
    protected readonly prisma: PrismaService,
    protected readonly crawlCache: CrawlCacheService,
    protected readonly lightweightFetch: LightweightFetchService,
  ) {
    super();
  }

  /**
   * `requiresFull` is threaded through (rather than hardcoded here) so a
   * later full-crawl (Playwright) endpoint can share this same method with
   * `requiresFull: true` - CrawlCacheService.getFreshObservation already
   * implements the "a full crawl satisfies a lightweight request, not vice
   * versa" rule this depends on.
   */
  protected async resolveObservations(
    job: AnalyzeJobData,
    requiresFull: false,
  ): Promise<ResolvedObservations> {
    void requiresFull;
    const normalizedUrl = normalizeUrl(job.url);

    const cached = await this.crawlCache.getFreshObservation(
      normalizedUrl,
      'lightweight',
    );
    if (cached) {
      return {
        observations: cached.rawObservations as unknown as
          LightweightObservations | RawObservations,
        crawlType: cached.crawlType,
        cacheHit: true,
      };
    }

    const observations = await this.lightweightFetch.fetch(job.url);
    await this.crawlCache.storeCrawlObservation({
      url: job.url,
      normalizedUrl,
      rawObservations: observations as unknown as Prisma.InputJsonValue,
      crawlType: CrawlType.lightweight,
    });

    return { observations, crawlType: CrawlType.lightweight, cacheHit: false };
  }

  /**
   * A cached `full` observation is already RawObservations-shaped (produced
   * by a future Playwright-based crawler) and is passed through as-is; a
   * `lightweight` one needs adapting.
   */
  protected toRawObservations(resolved: ResolvedObservations): RawObservations {
    if (resolved.crawlType === 'full') {
      return resolved.observations as RawObservations;
    }
    return toRawObservationsShape(
      resolved.observations as LightweightObservations,
    );
  }

  protected async updateStage(
    analyzeJobId: string,
    stage: string,
  ): Promise<void> {
    await this.prisma.analyzeJob.update({
      where: { id: analyzeJobId },
      data: { progressStage: stage },
    });
  }

  /**
   * Call once, as the very first DB write in `process()` - flips status from
   * `queued` to `running` alongside the first progress stage. Every later
   * transition goes through `updateStage` (progressStage only) so it can't
   * clobber the terminal status `completeJob`/`failJob` set.
   */
  protected async markRunning(
    analyzeJobId: string,
    stage: string,
  ): Promise<void> {
    await this.prisma.analyzeJob.update({
      where: { id: analyzeJobId },
      data: { status: AnalyzeJobStatus.running, progressStage: stage },
    });
  }

  protected async completeJob(
    analyzeJobId: string,
    result: Record<string, any>,
  ): Promise<void> {
    await this.prisma.analyzeJob.update({
      where: { id: analyzeJobId },
      data: {
        status: AnalyzeJobStatus.completed,
        progressStage: 'completed',
        completedAt: new Date(),
        // Analyzer output is ultimately derived from fetched HTML/text (e.g.
        // evidence strings, meta tag content) - same jsonb NUL/lone-surrogate
        // rejection risk as rawObservations, see crawl-cache.service.ts.
        result: sanitizeForJsonb(result) as Prisma.InputJsonValue,
      },
    });
  }

  protected async failJob(
    analyzeJobId: string,
    error: Error,
    stage: string,
  ): Promise<void> {
    await this.prisma.analyzeJob.update({
      where: { id: analyzeJobId },
      data: {
        status: AnalyzeJobStatus.failed,
        errorMessage: error.message,
        progressStage: stage,
      },
    });
  }

  abstract process(job: Job<AnalyzeJobData>): Promise<void>;
}
