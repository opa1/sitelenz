import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config';

/**
 * Thrown inside a heavy processor when a job has waited longer than
 * MAX_CAPACITY_WAIT_MS for a browser slot. Plain Error subclass with a
 * `.code` (matching LightweightFetchError/crawl.errors conventions): the
 * processor's catch block turns it into a failed job + analyze.failed
 * webhook like any other failure, and the job can be re-run for free via
 * the retry endpoint.
 */
export class CapacityTimeoutError extends Error {
  readonly code = 'CAPACITY_TIMEOUT';
  constructor(endpoint: string, analyzeJobId: string, waitedMs: number) {
    super(
      `Gave up waiting for a free analysis slot after ${Math.round(waitedMs / 1000)}s. ` +
        `This job can be retried for free at POST /v1/analyze/${endpoint}/${analyzeJobId}/retry`,
    );
  }
}

/**
 * Caps how many heavy analyze jobs (the Playwright-backed endpoints:
 * performance/ux-accessibility/screenshots/ai-summary/standard/full) run at
 * once, in addition to each queue's own `concurrency: 1` worker setting -
 * separate queues at concurrency 1 would otherwise still let several browser
 * contexts run simultaneously against the one shared BrowserService Chromium
 * instance, regardless of MAX_CONCURRENT_ANALYSES.
 *
 * One slot is held per JOB, for the whole process() call - not per browser
 * context. Per-context slots let a composite job holding its desktop context
 * fail to get a second slot for the mobile screenshot (or deadlock against
 * other jobs doing the same), and the job is already paid for by the time it
 * runs, so it must never fail for lack of a slot.
 *
 * `tryAcquire` never throws and never waits: a caller that gets `false` puts
 * its BullMQ job back in the queue with a short delay (see
 * BaseHeavyAnalyzeProcessor.acquireSlotOrDelay) rather than blocking a worker
 * or holding the job's lock. In-memory and scoped to this process is the
 * right granularity: BrowserService's Chromium instance is itself a
 * per-process singleton, so a horizontally-scaled deployment gets one gate
 * (and one browser) per instance.
 */
@Injectable()
export class HeavyAnalyzeConcurrencyGate {
  private active = 0;

  constructor(private readonly appConfigService: AppConfigService) {}

  /** Longest a job may keep waiting for a slot (MAX_CAPACITY_WAIT_MS). */
  get maxWaitMs(): number {
    return this.appConfigService.maxCapacityWaitMs;
  }

  tryAcquire(): boolean {
    if (this.active >= this.appConfigService.maxConcurrentAnalyses) {
      return false;
    }
    this.active += 1;
    return true;
  }

  release(): void {
    this.active = Math.max(0, this.active - 1);
  }
}
