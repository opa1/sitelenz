import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config';

/**
 * Thrown when a heavy analyze job can't get a browser-context slot. Plain
 * Error subclass with a `.code` (matching LightweightFetchError/crawl.errors
 * conventions) rather than the HTTP-oriented CapacityExceededException -
 * this fires inside a BullMQ worker, not a request handler, so there's no
 * response to attach a 429 to; the job just fails with this code and can be
 * retried later via the retry endpoint.
 */
export class HeavyAnalyzeCapacityError extends Error {
  readonly code = 'CAPACITY_EXCEEDED';
  constructor(
    message = 'Heavy analyze capacity is currently full. Please retry shortly.',
  ) {
    super(message);
  }
}

/**
 * Caps how many Playwright browser contexts the heavy analyze endpoints
 * (performance/ux-accessibility/screenshots) may have open at once, in
 * addition to each queue's own `concurrency: 1` worker setting - three
 * separate queues at concurrency 1 would otherwise still let up to three
 * browser contexts run simultaneously against the one shared BrowserService
 * Chromium instance, regardless of MAX_CONCURRENT_ANALYSES. In-memory and
 * scoped to this process is the right granularity: BrowserService's Chromium
 * instance is itself a per-process singleton, so a horizontally-scaled
 * deployment gets one gate (and one browser) per instance, which is exactly
 * what needs to be capped.
 */
@Injectable()
export class HeavyAnalyzeConcurrencyGate {
  private active = 0;

  constructor(private readonly appConfigService: AppConfigService) {}

  acquire(): void {
    if (this.active >= this.appConfigService.maxConcurrentAnalyses) {
      throw new HeavyAnalyzeCapacityError();
    }
    this.active += 1;
  }

  release(): void {
    this.active = Math.max(0, this.active - 1);
  }
}
