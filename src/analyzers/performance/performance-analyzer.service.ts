import { Injectable } from '@nestjs/common';
import type {
  NetworkRequestRecord,
  RawObservations,
  ResourceSummary,
  TimingInfo,
} from '../../common/browser/raw-observations.interface';
import type { Analyzer, AnalyzerOptions } from '../analyzer.interface';
import { getHeader } from '../../common/utils/headers.util';
import { getBaseDomain } from '../../common/utils/url.util';
import { createSafe } from '../../common/utils/analyzer-safety.util';

const safe = createSafe('performance');
import {
  getLighthouseAudit,
  getLighthouseCategoryScore,
  type LighthouseAudit,
} from '../../common/utils/lighthouse.util';
import type { LighthouseResult } from '../../common/browser/raw-observations.interface';
import type {
  BrowserTiming,
  CachingResult,
  ImageOptimization,
  MetricScore,
  MetricValue,
  PageWeight,
  PerformanceLighthouse,
  PerformanceResult,
  ResourceInventory,
  ResourceInventoryEntry,
  ThirdPartyAnalysis,
} from './performance-result.interface';

const MAX_INVENTORY_URLS = 30;
const MAX_THIRD_PARTY_DOMAINS = 50;

function scoreFor(
  value: number,
  goodMax: number,
  poorMin: number,
): MetricScore {
  if (value < goodMax) return 'good';
  if (value > poorMin) return 'poor';
  return 'needs-improvement';
}

function metricFromAudit(
  audit: LighthouseAudit | null,
  goodMax: number,
  poorMin: number,
): MetricValue | null {
  if (!audit || typeof audit.numericValue !== 'number') return null;
  return {
    value: audit.numericValue,
    score: scoreFor(audit.numericValue, goodMax, poorMin),
  };
}

function buildLighthouseMetrics(
  lhr: LighthouseResult | null,
): PerformanceLighthouse {
  const speedIndexAudit = getLighthouseAudit(lhr, 'speed-index');
  return {
    performanceScore: getLighthouseCategoryScore(lhr, 'performance'),
    accessibilityScore: getLighthouseCategoryScore(lhr, 'accessibility'),
    lcp: metricFromAudit(
      getLighthouseAudit(lhr, 'largest-contentful-paint'),
      2500,
      4000,
    ),
    cls: metricFromAudit(
      getLighthouseAudit(lhr, 'cumulative-layout-shift'),
      0.1,
      0.25,
    ),
    fcp: metricFromAudit(
      getLighthouseAudit(lhr, 'first-contentful-paint'),
      1800,
      3000,
    ),
    tbt: metricFromAudit(
      getLighthouseAudit(lhr, 'total-blocking-time'),
      200,
      600,
    ),
    ttfb: metricFromAudit(
      getLighthouseAudit(lhr, 'server-response-time'),
      800,
      1800,
    ),
    speedIndex:
      speedIndexAudit && typeof speedIndexAudit.numericValue === 'number'
        ? { value: speedIndexAudit.numericValue }
        : null,
  };
}

function buildPageWeight(resourceSummary: ResourceSummary): PageWeight {
  return {
    totalRequests: resourceSummary.totalRequests,
    totalSizeBytes: resourceSummary.totalSize,
    totalSizeKb: Math.round(resourceSummary.totalSize / 1024),
    byType: resourceSummary.byType,
  };
}

function buildTiming(timing: TimingInfo): BrowserTiming {
  return {
    domContentLoadedMs: timing.domContentLoaded,
    loadCompleteMs: timing.loadComplete,
  };
}

function auditPassed(audit: LighthouseAudit | null): boolean {
  return typeof audit?.score === 'number' && audit.score >= 0.9;
}

function buildImageOptimization(
  lhr: LighthouseResult | null,
): ImageOptimization | null {
  if (!lhr) return null;
  return {
    optimized: auditPassed(getLighthouseAudit(lhr, 'uses-optimized-images')),
    webp: auditPassed(getLighthouseAudit(lhr, 'uses-webp-images')),
    responsive: auditPassed(getLighthouseAudit(lhr, 'uses-responsive-images')),
  };
}

function buildCaching(headers: Record<string, string>): CachingResult {
  const value = getHeader(headers, 'cache-control');
  return {
    present: !!value,
    value,
    hasMaxAge: !!value && /max-age=/i.test(value),
  };
}

function buildResourceInventory(
  networkRequests: NetworkRequestRecord[],
): ResourceInventory {
  const group = (resourceType: string): ResourceInventoryEntry => {
    const matches = networkRequests.filter(
      (r) => r.resourceType === resourceType,
    );
    const totalUrls = [...new Set(matches.map((r) => r.url))].slice(
      0,
      MAX_INVENTORY_URLS,
    );
    return { count: matches.length, totalUrls };
  };
  return {
    scripts: group('script'),
    stylesheets: group('stylesheet'),
    images: group('image'),
    fonts: group('font'),
  };
}

function buildThirdPartyAnalysis(
  networkRequests: NetworkRequestRecord[],
  pageUrl: string,
): ThirdPartyAnalysis {
  const ownDomain = getBaseDomain(pageUrl);
  const domains = new Set<string>();
  let requestCount = 0;

  for (const request of networkRequests) {
    const domain = getBaseDomain(request.url);
    if (!domain || domain === ownDomain) continue;
    requestCount += 1;
    if (domains.size < MAX_THIRD_PARTY_DOMAINS) domains.add(domain);
  }

  const percent =
    networkRequests.length > 0
      ? Math.round((requestCount / networkRequests.length) * 100)
      : 0;

  return { domains: [...domains], requestCount, percent };
}

@Injectable()
export class PerformanceAnalyzerService implements Analyzer {
  analyze(
    observations: RawObservations,
    options: AnalyzerOptions,
  ): Promise<PerformanceResult> {
    const emptyLighthouse: PerformanceLighthouse = {
      performanceScore: null,
      accessibilityScore: null,
      lcp: null,
      cls: null,
      fcp: null,
      tbt: null,
      ttfb: null,
      speedIndex: null,
    };

    const result: PerformanceResult = {
      lighthouse: safe(
        () => buildLighthouseMetrics(observations.lighthouseResult),
        emptyLighthouse,
      ),
      pageWeight: safe(() => buildPageWeight(observations.resourceSummary), {
        totalRequests: 0,
        totalSizeBytes: 0,
        totalSizeKb: 0,
        byType: {},
      }),
      timing: safe(() => buildTiming(observations.timing), {
        domContentLoadedMs: 0,
        loadCompleteMs: 0,
      }),
      imageOptimization: safe(
        () => buildImageOptimization(observations.lighthouseResult),
        null,
      ),
      caching: safe(() => buildCaching(observations.responseHeaders), {
        present: false,
        value: null,
        hasMaxAge: false,
      }),
    };

    if (options.deep) {
      result.resourceInventory = safe(
        () => buildResourceInventory(observations.networkRequests),
        {
          scripts: { count: 0, totalUrls: [] },
          stylesheets: { count: 0, totalUrls: [] },
          images: { count: 0, totalUrls: [] },
          fonts: { count: 0, totalUrls: [] },
        },
      );
      result.thirdParty = safe(
        () =>
          buildThirdPartyAnalysis(
            observations.networkRequests,
            observations.url,
          ),
        { domains: [], requestCount: 0, percent: 0 },
      );
    }

    return Promise.resolve(result);
  }
}
