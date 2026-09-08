import { loadHtml } from '../common/utils/html.util';
import type {
  CookieRecord,
  RawObservations,
  ScriptRef,
} from '../common/browser/raw-observations.interface';
import type { LightweightObservations } from './lightweight-observations.interface';

function parseScripts(html: string): ScriptRef[] {
  const $ = loadHtml(html);
  const scripts: ScriptRef[] = [];
  $('script').each((_, el) => {
    const src = $(el).attr('src');
    if (src) {
      scripts.push({ src, inline: false });
    } else {
      scripts.push({ inline: true, content: $(el).contents().text() });
    }
  });
  return scripts;
}

function parseCookies(rawCookies: string[], pageUrl: string): CookieRecord[] {
  let fallbackDomain = '';
  try {
    fallbackDomain = new URL(pageUrl).hostname;
  } catch {
    fallbackDomain = '';
  }

  return rawCookies.map((raw) => {
    const [nameValue, ...attrs] = raw.split(';').map((part) => part.trim());
    const eqIndex = nameValue.indexOf('=');
    const name = eqIndex === -1 ? nameValue : nameValue.slice(0, eqIndex);

    let domain = fallbackDomain;
    let path = '/';
    let secure = false;
    let httpOnly = false;
    let sameSite: string | undefined;

    for (const attr of attrs) {
      const [rawKey, rawVal] = attr.split('=');
      const key = rawKey?.trim().toLowerCase();
      const value = rawVal?.trim();
      if (key === 'domain' && value) domain = value;
      else if (key === 'path' && value) path = value;
      else if (key === 'secure') secure = true;
      else if (key === 'httponly') httpOnly = true;
      else if (key === 'samesite' && value) sameSite = value;
    }

    return { name, domain, path, secure, httpOnly, sameSite };
  });
}

/**
 * Adapts a plain-fetch LightweightObservations into the RawObservations
 * shape the existing analyzers expect, so they can run unmodified against a
 * lightweight (no-Playwright) crawl. Fields Playwright alone can produce
 * (network requests, executed-JS window keys, timing, Lighthouse) are
 * defaulted to empty/null - every analyzer reads them through a `safe()`
 * wrapper, so this degrades detection quality rather than breaking it.
 * `scripts` and `cookies`, unlike those, are derivable from the fetched
 * HTML/headers alone and are populated for real.
 */
export function toRawObservationsShape(
  observations: LightweightObservations,
): RawObservations {
  return {
    url: observations.url,
    statusCode: observations.statusCode,
    responseHeaders: observations.responseHeaders,
    html: observations.html,
    title: observations.title,
    metaTags: observations.metaTags,
    scripts: parseScripts(observations.html),
    networkRequests: [],
    cookies: parseCookies(observations.cookies, observations.url),
    consoleLogs: [],
    windowKeys: [],
    timing: { navigationStart: 0, domContentLoaded: 0, loadComplete: 0 },
    resourceSummary: {
      totalRequests: 0,
      totalSize: observations.html.length,
      byType: {},
    },
    redirectChain: observations.redirectChain,
    lighthouseResult: null,
  };
}
