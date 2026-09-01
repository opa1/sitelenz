import { Injectable } from '@nestjs/common';
import type {
  BrowserContext,
  Page,
  Response as PlaywrightResponse,
} from 'playwright';
import { AppConfigService } from '../../config';
import {
  MAX_URL_REDIRECTS,
  UrlValidatorService,
} from '../utils/url-validator.service';
import {
  AnalysisTimeoutError,
  SsrfDetectedError,
  WebsiteUnavailableError,
} from './crawl.errors';
import type {
  ConsoleLogRecord,
  CookieRecord,
  MetaTag,
  NetworkRequestRecord,
  RawObservations,
  ResourceSummary,
  ScriptRef,
  TimingInfo,
} from './raw-observations.interface';

const BLOCKED_RESOURCE_TYPES = new Set(['media', 'websocket']);
const MAX_NETWORK_REQUESTS = 200;
const MAX_CONSOLE_LOGS = 50;
const MAX_INLINE_SCRIPT_CHARS = 2000;

@Injectable()
export class ObservationCollector {
  private baselineWindowKeys: Set<string> | null = null;

  constructor(
    private readonly appConfigService: AppConfigService,
    private readonly urlValidator: UrlValidatorService,
  ) {}

  async collect(
    context: BrowserContext,
    url: string,
  ): Promise<RawObservations> {
    const page = await context.newPage();
    try {
      return await this.collectFromPage(context, page, url);
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  private async collectFromPage(
    context: BrowserContext,
    page: Page,
    url: string,
  ): Promise<RawObservations> {
    const consoleLogs: ConsoleLogRecord[] = [];
    const networkRequests: NetworkRequestRecord[] = [];
    const redirectChain: string[] = [];
    const resourceSummary: ResourceSummary = {
      totalRequests: 0,
      totalSize: 0,
      byType: {},
    };

    let ssrfBlockedReason: string | null = null;
    let redirectLimitExceeded = false;

    page.on('console', (msg) => {
      if (consoleLogs.length < MAX_CONSOLE_LOGS) {
        consoleLogs.push({ type: msg.type(), text: msg.text() });
      }
    });

    page.on('response', (response) => {
      const request = response.request();
      const resourceType = request.resourceType();
      resourceSummary.totalRequests += 1;
      resourceSummary.byType[resourceType] =
        (resourceSummary.byType[resourceType] ?? 0) + 1;
      const contentLength = response.headers()['content-length'];
      if (contentLength) {
        const size = Number(contentLength);
        if (Number.isFinite(size)) {
          resourceSummary.totalSize += size;
        }
      }
      if (networkRequests.length < MAX_NETWORK_REQUESTS) {
        networkRequests.push({
          url: request.url(),
          resourceType,
          status: response.status(),
        });
      }
    });

    // Re-checked on every navigation (including redirects): a redirect could
    // point at a private IP even though the original URL passed the upfront
    // SSRF check in UrlValidatorService.
    await page.route('**/*', async (route) => {
      const request = route.request();
      const resourceType = request.resourceType();

      if (
        request.isNavigationRequest() &&
        request.frame() === page.mainFrame()
      ) {
        const targetUrl = request.url();
        if (redirectChain[redirectChain.length - 1] !== targetUrl) {
          redirectChain.push(targetUrl);
        }
        if (redirectChain.length > MAX_URL_REDIRECTS + 1) {
          redirectLimitExceeded = true;
          await route.abort();
          return;
        }
        const check = await this.urlValidator.validate(targetUrl);
        if (!check.valid) {
          ssrfBlockedReason = check.reason;
          await route.abort();
          return;
        }
      }

      if (BLOCKED_RESOURCE_TYPES.has(resourceType)) {
        await route.abort();
        return;
      }

      await route.continue();
    });

    let response: PlaywrightResponse | null;
    try {
      response = await page.goto(url, {
        waitUntil: 'load',
        timeout: this.appConfigService.analysisTimeoutMs,
      });
    } catch (error) {
      if (ssrfBlockedReason) {
        throw new SsrfDetectedError(ssrfBlockedReason);
      }
      if (redirectLimitExceeded) {
        throw new Error(`Exceeded maximum of ${MAX_URL_REDIRECTS} redirects`);
      }
      const message = (error as Error).message;
      if (/timeout/i.test(message)) {
        throw new AnalysisTimeoutError(message);
      }
      throw new WebsiteUnavailableError(message);
    }

    if (ssrfBlockedReason) {
      throw new SsrfDetectedError(ssrfBlockedReason);
    }
    if (redirectLimitExceeded) {
      throw new Error(`Exceeded maximum of ${MAX_URL_REDIRECTS} redirects`);
    }
    if (!response) {
      throw new WebsiteUnavailableError(
        'No response received from the website',
      );
    }

    const html = await page.content();
    const title = await page.title();

    const metaTags: MetaTag[] = await page.evaluate(() =>
      Array.from(document.querySelectorAll('meta')).map((el) => ({
        name: el.getAttribute('name') ?? undefined,
        property: el.getAttribute('property') ?? undefined,
        content: el.getAttribute('content') ?? undefined,
      })),
    );

    const scripts: ScriptRef[] = await page.evaluate((maxChars) => {
      return Array.from(document.querySelectorAll('script')).map((el) => {
        const src = el.getAttribute('src');
        if (src) {
          return { src, inline: false };
        }
        return {
          inline: true,
          content: (el.textContent ?? '').slice(0, maxChars),
        };
      });
    }, MAX_INLINE_SCRIPT_CHARS);

    const timing: TimingInfo = await page.evaluate(() => {
      const t = performance.timing;
      return {
        navigationStart: t.navigationStart,
        domContentLoaded: t.domContentLoadedEventEnd - t.navigationStart,
        loadComplete: t.loadEventEnd - t.navigationStart,
      };
    });

    const baseline = await this.getBaselineWindowKeys(context);
    const windowKeys: string[] = await page.evaluate((baselineKeys) => {
      return Object.keys(window).filter((key) => !baselineKeys.includes(key));
    }, Array.from(baseline));

    const rawCookies = await context.cookies(url);
    const cookies: CookieRecord[] = rawCookies.map((cookie) => ({
      name: cookie.name,
      domain: cookie.domain,
      path: cookie.path,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
    }));

    return {
      url: response.url(),
      statusCode: response.status(),
      responseHeaders: response.headers(),
      html,
      title,
      metaTags,
      scripts,
      networkRequests,
      cookies,
      consoleLogs,
      windowKeys,
      timing,
      resourceSummary,
      redirectChain,
      lighthouseResult: null,
    };
  }

  private async getBaselineWindowKeys(
    context: BrowserContext,
  ): Promise<Set<string>> {
    if (this.baselineWindowKeys) {
      return this.baselineWindowKeys;
    }
    const blankPage = await context.newPage();
    try {
      const keys = await blankPage.evaluate(() => Object.keys(window));
      this.baselineWindowKeys = new Set(keys);
      return this.baselineWindowKeys;
    } finally {
      await blankPage.close().catch(() => undefined);
    }
  }
}
