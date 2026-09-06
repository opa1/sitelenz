import { Injectable, Logger } from '@nestjs/common';
import type {
  MetaTag,
  RawObservations,
} from '../../common/browser/raw-observations.interface';
import type { Analyzer, AnalyzerOptions } from '../analyzer.interface';
import { loadHtml, type CheerioAPI } from '../../common/utils/html.util';
import { getHeader } from '../../common/utils/headers.util';
import {
  createSafe,
  withTimeout,
} from '../../common/utils/analyzer-safety.util';

const safe = createSafe('seo');
import { getLighthouseCategoryScore } from '../../common/utils/lighthouse.util';
import type {
  HeadingIssue,
  MetaDescriptionIssue,
  OgField,
  RobotsDirectives,
  SeoHeadings,
  SeoHreflang,
  SeoImages,
  SeoOpenGraph,
  SeoResult,
  SeoRobots,
  SeoRobotsTxt,
  SeoSitemap,
  SeoStructuredData,
  SeoTwitterCard,
  StructuredDataItem,
  TitleIssue,
  TwitterCardType,
} from './seo-result.interface';

const ROBOTS_TXT_TIMEOUT_MS = 2500;
const SITEMAP_TIMEOUT_MS = 2500;
const MAX_ROBOTS_TXT_CHARS = 200_000;
const MAX_SITEMAP_CHARS = 5_000_000;
const MAX_SITEMAP_ENTRIES = 500;

function getMetaContent(
  $: CheerioAPI,
  metaTags: MetaTag[],
  name: string,
): string | null {
  const fromTags = metaTags.find(
    (m) => m.name?.toLowerCase() === name.toLowerCase(),
  )?.content;
  if (fromTags) return fromTags;
  const fromDom = $(`meta[name="${name}"]`).attr('content');
  return fromDom ?? null;
}

function getMetaProperty(
  $: CheerioAPI,
  metaTags: MetaTag[],
  property: string,
): string | null {
  const fromTags = metaTags.find(
    (m) => m.property?.toLowerCase() === property.toLowerCase(),
  )?.content;
  if (fromTags) return fromTags;
  const fromDom = $(`meta[property="${property}"]`).attr('content');
  return fromDom ?? null;
}

function ogField(value: string | null): OgField {
  return { present: value !== null && value !== '', value };
}

function parseRobotsDirectives(content: string): RobotsDirectives {
  const lower = content.toLowerCase();
  return {
    noindex: /\bnoindex\b/.test(lower),
    nofollow: /\bnofollow\b/.test(lower),
    noarchive: /\bnoarchive\b/.test(lower),
  };
}

function normalizeTwitterCardType(value: string | null): TwitterCardType {
  const v = (value ?? '').toLowerCase().trim();
  if (
    v === 'summary' ||
    v === 'summary_large_image' ||
    v === 'app' ||
    v === 'player'
  ) {
    return v;
  }
  return 'unknown';
}

function normalizeUrlForCompare(u: string): string {
  return u.trim().replace(/\/$/, '');
}

function buildTitle($: CheerioAPI, observations: RawObservations) {
  const value =
    ($('title').first().text() || observations.title || '').trim() || null;
  const present = !!value;
  const length = value?.length ?? 0;
  const issues: TitleIssue[] = [];
  if (!present) {
    issues.push('missing');
  } else if (length < 30) {
    issues.push('too_short');
  } else if (length > 60) {
    issues.push('too_long');
  }
  return { present, value, length, issues };
}

function buildMetaDescription($: CheerioAPI, metaTags: MetaTag[]) {
  const value = getMetaContent($, metaTags, 'description');
  const present = !!value;
  const length = value?.length ?? 0;
  const issues: MetaDescriptionIssue[] = [];
  if (!present) {
    issues.push('missing');
  } else if (length < 70) {
    issues.push('too_short');
  } else if (length > 160) {
    issues.push('too_long');
  }
  return { present, value, length, issues };
}

function buildCanonical($: CheerioAPI, currentUrl: string) {
  const value = $('link[rel="canonical"]').attr('href') ?? null;
  const present = !!value;
  const matchesCurrentUrl =
    present &&
    normalizeUrlForCompare(value) === normalizeUrlForCompare(currentUrl);
  return { present, value, matchesCurrentUrl };
}

function buildRobots(
  $: CheerioAPI,
  metaTags: MetaTag[],
  headers: Record<string, string>,
): SeoRobots {
  const metaContent = getMetaContent($, metaTags, 'robots');
  const headerContent = getHeader(headers, 'x-robots-tag');
  const meta = metaContent ? parseRobotsDirectives(metaContent) : null;
  const header = headerContent ? parseRobotsDirectives(headerContent) : null;
  const indexable = !(meta?.noindex || header?.noindex);
  return { meta, header, indexable };
}

function buildOpenGraph($: CheerioAPI, metaTags: MetaTag[]): SeoOpenGraph {
  const title = ogField(getMetaProperty($, metaTags, 'og:title'));
  const description = ogField(getMetaProperty($, metaTags, 'og:description'));
  const image = ogField(getMetaProperty($, metaTags, 'og:image'));
  const type = ogField(getMetaProperty($, metaTags, 'og:type'));
  const url = ogField(getMetaProperty($, metaTags, 'og:url'));
  const complete = [title, description, image, type, url].every(
    (f) => f.present,
  );
  return { title, description, image, type, url, complete };
}

function buildTwitterCard($: CheerioAPI, metaTags: MetaTag[]): SeoTwitterCard {
  const card = ogField(getMetaContent($, metaTags, 'twitter:card'));
  const title = ogField(getMetaContent($, metaTags, 'twitter:title'));
  const description = ogField(
    getMetaContent($, metaTags, 'twitter:description'),
  );
  const image = ogField(getMetaContent($, metaTags, 'twitter:image'));
  const cardType = normalizeTwitterCardType(card.value);
  return { card, title, description, image, cardType };
}

function buildHeadings($: CheerioAPI): SeoHeadings {
  const h1s = $('h1');
  const h2s = $('h2');
  const h1Values = h1s
    .map((_, el) => $(el).text().trim())
    .get()
    .filter((v) => v.length > 0);
  const issues: HeadingIssue[] = [];
  if (h1s.length === 0) issues.push('missing_h1');
  if (h1s.length > 1) issues.push('multiple_h1');

  let maxSeen = 0;
  let skipped = false;
  $('h1,h2,h3,h4,h5,h6').each((_, el) => {
    const level = Number(el.tagName.toLowerCase().slice(1));
    if (Number.isFinite(level)) {
      if (level > maxSeen + 1) skipped = true;
      if (level > maxSeen) maxSeen = level;
    }
  });
  if (skipped) issues.push('skipped_levels');

  return { h1Count: h1s.length, h2Count: h2s.length, h1Values, issues };
}

function buildImages($: CheerioAPI): SeoImages {
  const imgs = $('img');
  let withAlt = 0;
  let withEmptyAlt = 0;
  let missingAlt = 0;
  imgs.each((_, el) => {
    const alt = $(el).attr('alt');
    if (alt === undefined) missingAlt += 1;
    else if (alt.trim() === '') withEmptyAlt += 1;
    else withAlt += 1;
  });
  const total = imgs.length;
  const altCoveragePercent =
    total > 0 ? Math.round((withAlt / total) * 100) : 0;
  return { total, withAlt, withEmptyAlt, missingAlt, altCoveragePercent };
}

function buildStructuredData($: CheerioAPI): SeoStructuredData {
  const items: StructuredDataItem[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const content = $(el).contents().text();
    try {
      const parsed: unknown = JSON.parse(content);
      let type: string | null = null;
      if (parsed && typeof parsed === 'object' && '@type' in parsed) {
        const typeRaw = (parsed as Record<string, unknown>)['@type'];
        if (typeof typeRaw === 'string') type = typeRaw;
        else if (Array.isArray(typeRaw)) {
          type = typeRaw.filter((t) => typeof t === 'string').join(', ');
        }
      }
      items.push({ type: type || null, valid: true, raw: parsed });
    } catch {
      items.push({ type: null, valid: false, raw: null });
    }
  });
  const types = [
    ...new Set(
      items
        .filter((i): i is StructuredDataItem & { type: string } => !!i.type)
        .map((i) => i.type),
    ),
  ];
  return { items, types };
}

function buildHreflang($: CheerioAPI): SeoHreflang {
  const languages = new Set<string>();
  $('link[rel="alternate"][hreflang]').each((_, el) => {
    const lang = $(el).attr('hreflang');
    if (lang) languages.add(lang);
  });
  return { present: languages.size > 0, languages: [...languages] };
}

interface ParsedRobotsTxt extends SeoRobotsTxt {
  sitemapUrls: string[];
}

function parseRobotsTxt(text: string): ParsedRobotsTxt {
  const lines = text.split(/\r?\n/);
  const disallowedPaths = new Set<string>();
  const sitemapUrls: string[] = [];
  let currentAgentIsWildcard = false;
  let blanketDisallow = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) continue;
    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();

    if (key === 'user-agent') {
      currentAgentIsWildcard = value === '*';
    } else if (key === 'disallow') {
      if (value) disallowedPaths.add(value);
      if (currentAgentIsWildcard && value === '/') blanketDisallow = true;
    } else if (key === 'sitemap' && value) {
      sitemapUrls.push(value);
    }
  }

  return {
    present: true,
    allowsIndexing: !blanketDisallow,
    disallowedPaths: [...disallowedPaths],
    hasSitemapReference: sitemapUrls.length > 0,
    sitemapUrls,
  };
}

async function fetchRobotsTxt(baseUrl: string): Promise<ParsedRobotsTxt> {
  const fallback: ParsedRobotsTxt = {
    present: false,
    allowsIndexing: true,
    disallowedPaths: [],
    hasSitemapReference: false,
    sitemapUrls: [],
  };
  return withTimeout(
    async (signal) => {
      const robotsUrl = new URL('/robots.txt', baseUrl).toString();
      const res = await fetch(robotsUrl, { signal, redirect: 'follow' });
      if (!res.ok) return fallback;
      const text = (await res.text()).slice(0, MAX_ROBOTS_TXT_CHARS);
      return parseRobotsTxt(text);
    },
    ROBOTS_TXT_TIMEOUT_MS,
    fallback,
  );
}

async function fetchSitemap(sitemapUrl: string): Promise<SeoSitemap> {
  const fallback: SeoSitemap = {
    present: false,
    url: sitemapUrl,
    entryCount: null,
  };
  return withTimeout(
    async (signal) => {
      const res = await fetch(sitemapUrl, { signal, redirect: 'follow' });
      if (!res.ok) return fallback;
      const text = (await res.text()).slice(0, MAX_SITEMAP_CHARS);
      const matches = text.match(/<(url|sitemap)>/gi) ?? [];
      return {
        present: true,
        url: sitemapUrl,
        entryCount: Math.min(matches.length, MAX_SITEMAP_ENTRIES),
      };
    },
    SITEMAP_TIMEOUT_MS,
    fallback,
  );
}

@Injectable()
export class SeoAnalyzerService implements Analyzer {
  private readonly logger = new Logger(SeoAnalyzerService.name);

  async analyze(
    observations: RawObservations,
    options: AnalyzerOptions,
  ): Promise<SeoResult> {
    const $ = safe(() => loadHtml(observations.html), null);

    const result: SeoResult = {
      title: safe(() => buildTitle($ as CheerioAPI, observations), {
        present: false,
        value: null,
        length: 0,
        issues: ['missing'],
      }),
      metaDescription: safe(
        () => buildMetaDescription($ as CheerioAPI, observations.metaTags),
        { present: false, value: null, length: 0, issues: ['missing'] },
      ),
      canonical: safe(() => buildCanonical($ as CheerioAPI, observations.url), {
        present: false,
        value: null,
        matchesCurrentUrl: false,
      }),
      robots: safe(
        () =>
          buildRobots(
            $ as CheerioAPI,
            observations.metaTags,
            observations.responseHeaders,
          ),
        { meta: null, header: null, indexable: true },
      ),
      openGraph: safe(
        () => buildOpenGraph($ as CheerioAPI, observations.metaTags),
        {
          title: { present: false, value: null },
          description: { present: false, value: null },
          image: { present: false, value: null },
          type: { present: false, value: null },
          url: { present: false, value: null },
          complete: false,
        },
      ),
      twitterCard: safe(
        () => buildTwitterCard($ as CheerioAPI, observations.metaTags),
        {
          card: { present: false, value: null },
          title: { present: false, value: null },
          description: { present: false, value: null },
          image: { present: false, value: null },
          cardType: 'unknown',
        },
      ),
      headings: safe(() => buildHeadings($ as CheerioAPI), {
        h1Count: 0,
        h2Count: 0,
        h1Values: [],
        issues: [],
      }),
      images: safe(() => buildImages($ as CheerioAPI), {
        total: 0,
        withAlt: 0,
        withEmptyAlt: 0,
        missingAlt: 0,
        altCoveragePercent: 0,
      }),
      structuredData: safe(() => buildStructuredData($ as CheerioAPI), {
        items: [],
        types: [],
      }),
      lighthouseSeoScore: safe(
        () => getLighthouseCategoryScore(observations.lighthouseResult, 'seo'),
        null,
      ),
    };

    if (options.deep) {
      const parsedRobotsTxt = await fetchRobotsTxt(observations.url).catch(
        (error: unknown) => {
          this.logger.warn(
            `robots.txt fetch failed: ${(error as Error).message}`,
          );
          return null;
        },
      );

      if (parsedRobotsTxt) {
        const { sitemapUrls, ...robotsTxt } = parsedRobotsTxt;
        result.robotsTxt = robotsTxt;

        if (sitemapUrls.length > 0) {
          result.sitemap = await fetchSitemap(sitemapUrls[0]).catch(
            (error: unknown) => {
              this.logger.warn(
                `sitemap fetch failed: ${(error as Error).message}`,
              );
              return { present: false, url: sitemapUrls[0], entryCount: null };
            },
          );
        }
      }

      result.hreflang = safe(() => buildHreflang($ as CheerioAPI), {
        present: false,
        languages: [],
      });
    }

    return result;
  }
}
