import { Injectable, Logger } from '@nestjs/common';
import { BrowserService } from './browser.service';
import type { LighthouseResult } from './raw-observations.interface';

const LIGHTHOUSE_CATEGORIES = [
  'performance',
  'accessibility',
  'seo',
  'best-practices',
];

/**
 * Runs Lighthouse against BrowserService's shared Chromium over CDP (via its
 * --remote-debugging-port), rather than spawning a separate Chrome. When no
 * `page` argument is given, Lighthouse's own runner connects to that port
 * itself (puppeteer.connect({ browserURL })) and drives its own tab - this is
 * the documented fallback path in Lighthouse's navigation runner, not a
 * workaround.
 */
@Injectable()
export class LighthouseService {
  private readonly logger = new Logger(LighthouseService.name);

  /**
   * Lighthouse tracks its own run via process-global performance marks
   * (`performance.mark`/`measure`) and is not safe to invoke concurrently
   * within one Node process - two overlapping runs corrupt each other's
   * marks (observed live: "The 'start lh:runner:gather' performance mark
   * has not been set" when two heavy analyze jobs' crawls overlapped).
   * HeavyAnalyzeConcurrencyGate deliberately allows several browser contexts
   * to run at once (up to MAX_CONCURRENT_ANALYSES), so Lighthouse calls need
   * their own, stricter serialization on top of that - this promise chain is
   * a simple app-wide mutex: each call awaits the previous one before
   * starting.
   */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly browserService: BrowserService) {}

  run(url: string): Promise<LighthouseResult | null> {
    const result = this.queue.then(() => this.runNow(url));
    // Chained via .catch so one failed/rejected run doesn't leave the queue
    // permanently rejected for every run queued after it.
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async runNow(url: string): Promise<LighthouseResult | null> {
    try {
      const { default: lighthouse } = await import('lighthouse');
      const runnerResult = await lighthouse(url, {
        port: this.browserService.debugPort,
        onlyCategories: LIGHTHOUSE_CATEGORIES,
      });
      if (!runnerResult) {
        return null;
      }
      return runnerResult.lhr as unknown as LighthouseResult;
    } catch (error) {
      this.logger.warn(
        `Lighthouse run failed for ${url}: ${(error as Error).message}`,
      );
      return null;
    }
  }
}
