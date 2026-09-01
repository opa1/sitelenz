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
 * itself (puppeteer.connect({ browserURL })) and drives its own tab — this is
 * the documented fallback path in Lighthouse's navigation runner, not a
 * workaround.
 */
@Injectable()
export class LighthouseService {
  private readonly logger = new Logger(LighthouseService.name);

  constructor(private readonly browserService: BrowserService) {}

  async run(url: string): Promise<LighthouseResult | null> {
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
