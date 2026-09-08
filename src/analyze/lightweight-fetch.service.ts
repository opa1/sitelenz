import { Injectable } from '@nestjs/common';
import { loadHtml } from '../common/utils/html.util';
import {
  MAX_URL_REDIRECTS,
  UrlValidatorService,
} from '../common/utils/url-validator.service';
import { AppConfigService } from '../config';
import { LightweightFetchError } from './lightweight-fetch.errors';
import type { LightweightObservations } from './lightweight-observations.interface';

const MAX_BODY_BYTES = 5 * 1024 * 1024;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

async function readBodyCapped(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';

  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        const keep = value.byteLength - (total - MAX_BODY_BYTES);
        if (keep > 0) chunks.push(Buffer.from(value.subarray(0, keep)));
        break;
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return Buffer.concat(chunks).toString('utf8');
}

@Injectable()
export class LightweightFetchService {
  constructor(
    private readonly urlValidator: UrlValidatorService,
    private readonly appConfigService: AppConfigService,
  ) {}

  /**
   * Fetches `url` with a plain HTTP(S) request (no Playwright), following
   * redirects itself (rather than via fetch's `redirect: 'follow'`) so every
   * hop can be re-validated against the SSRF check - a redirect target is
   * attacker-controlled and DNS can legitimately differ from the
   * originally-validated URL.
   */
  async fetch(url: string): Promise<LightweightObservations> {
    const redirectChain: string[] = [];
    let currentUrl = url;
    let redirectCount = 0;

    for (;;) {
      const validation = await this.urlValidator.validate(currentUrl);
      if (!validation.valid) {
        throw new LightweightFetchError('WEBSITE_UNAVAILABLE', validation.reason);
      }

      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        this.appConfigService.analysisTimeoutMs,
      );

      let response: Response;
      try {
        response = await fetch(currentUrl, {
          redirect: 'manual',
          signal: controller.signal,
          headers: { 'User-Agent': USER_AGENT },
        });
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          throw new LightweightFetchError(
            'ANALYSIS_TIMEOUT',
            `Request to ${currentUrl} timed out after ${this.appConfigService.analysisTimeoutMs}ms`,
          );
        }
        throw new LightweightFetchError(
          'WEBSITE_UNAVAILABLE',
          `Unable to reach ${currentUrl}: ${(error as Error).message}`,
        );
      } finally {
        clearTimeout(timer);
      }

      const isRedirect = response.status >= 300 && response.status < 400;
      if (isRedirect) {
        const location = response.headers.get('location');
        if (!location) {
          throw new LightweightFetchError(
            'WEBSITE_UNAVAILABLE',
            `Redirect response (${response.status}) from ${currentUrl} is missing a Location header`,
          );
        }
        if (redirectCount >= MAX_URL_REDIRECTS) {
          throw new LightweightFetchError(
            'SSRF_REDIRECT_LIMIT',
            `Exceeded ${MAX_URL_REDIRECTS} redirects starting from ${url}`,
          );
        }
        redirectCount += 1;
        redirectChain.push(currentUrl);
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      const html = await readBodyCapped(response);
      const $ = loadHtml(html);
      const title = $('title').first().text().trim();
      const metaTags: LightweightObservations['metaTags'] = [];
      $('meta').each((_, el) => {
        const attribs = $(el).attr() ?? {};
        metaTags.push({
          name: attribs.name,
          property: attribs.property,
          content: attribs.content,
        });
      });

      const rawCookieHeaders = response.headers as Headers & {
        getSetCookie?: () => string[];
      };
      const cookies = rawCookieHeaders.getSetCookie?.() ?? [];

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      return {
        url: currentUrl,
        statusCode: response.status,
        responseHeaders,
        html,
        title,
        metaTags,
        cookies,
        redirectChain,
        fetchedAt: new Date().toISOString(),
      };
    }
  }
}
