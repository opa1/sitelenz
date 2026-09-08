import { Injectable } from '@nestjs/common';
import type { TechnologyResult } from '../analyzers/technology/technology-result.interface';
import type { SeoResult } from '../analyzers/seo/seo-result.interface';
import type { SecurityResult } from '../analyzers/security/security-result.interface';
import type { PerformanceResult } from '../analyzers/performance/performance-result.interface';
import type { BusinessResult } from '../analyzers/business/business-result.interface';
import type { UxResult } from '../analyzers/ux/ux-result.interface';
import { createSafe } from '../common/utils/analyzer-safety.util';
import type {
  AnalysisInput,
  CondensedBusiness,
  CondensedPerformance,
  CondensedSecurity,
  CondensedSeo,
  CondensedTechnology,
  CondensedUx,
} from './ai-input.interface';

const safe = createSafe('ai-input-builder');

export interface AnalyzerResultsBundle {
  technology: TechnologyResult;
  seo: SeoResult;
  security: SecurityResult;
  performance: PerformanceResult;
  business: BusinessResult;
  ux: UxResult;
}

/**
 * Recursively drops null/undefined/empty-string/empty-array/empty-object
 * values so the condensed payload sent to the model carries only fields the
 * analyzers actually determined. Booleans (including false) and numbers
 * (including 0) are meaningful findings and are always kept.
 */
function compactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    const arr = (value as unknown[])
      .map((v) => compactValue(v))
      .filter((v) => v !== undefined);
    return arr.length > 0 ? arr : undefined;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const cleaned = compactValue(v);
      if (cleaned === undefined || cleaned === null || cleaned === '') {
        continue;
      }
      out[key] = cleaned;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
  if (value === null || value === '') {
    return undefined;
  }
  return value;
}

function compact<T>(value: T): T | undefined {
  return compactValue(value) as T | undefined;
}

function condenseTechnology(
  technology: TechnologyResult,
): CondensedTechnology[] {
  return technology.technologies.map((t) => ({
    name: t.name,
    category: t.category,
  }));
}

function condenseSeo(seo: SeoResult): CondensedSeo {
  return {
    lighthouseSeoScore: seo.lighthouseSeoScore,
    titlePresent: seo.title.present,
    titleIssues: seo.title.issues,
    metaDescriptionPresent: seo.metaDescription.present,
    metaDescriptionIssues: seo.metaDescription.issues,
    canonicalPresent: seo.canonical.present,
    canonicalMatchesCurrentUrl: seo.canonical.matchesCurrentUrl,
    robotsIndexable: seo.robots.indexable,
    openGraphComplete: seo.openGraph.complete,
    twitterCardType: seo.twitterCard.cardType,
    h1Count: seo.headings.h1Count,
    headingIssues: seo.headings.issues,
    imageAltCoveragePercent: seo.images.altCoveragePercent,
    structuredDataTypes: seo.structuredData.types,
    robotsTxtPresent: seo.robotsTxt?.present,
    robotsTxtAllowsIndexing: seo.robotsTxt?.allowsIndexing,
    sitemapPresent: seo.sitemap?.present,
    hreflangPresent: seo.hreflang?.present,
  };
}

function condenseSecurity(security: SecurityResult): CondensedSecurity {
  return {
    securityScore: security.securityScore,
    httpsEnabled: security.https.enabled,
    mixedContent: security.https.mixedContent,
    hstsScore: security.headers.strictTransportSecurity.score,
    cspScore: security.headers.contentSecurityPolicy.score,
    xContentTypeOptionsCorrect: security.headers.xContentTypeOptions.correct,
    xFrameOptionsScore: security.headers.xFrameOptions.score,
    referrerPolicyScore: security.headers.referrerPolicy.score,
    permissionsPolicyPresent: security.headers.permissionsPolicy.present,
    cookieIssues: security.cookies?.issues,
    tlsValid: security.tlsCertificate?.valid,
    tlsDaysUntilExpiry: security.tlsCertificate?.daysUntilExpiry,
  };
}

function condensePerformance(
  performance: PerformanceResult,
): CondensedPerformance {
  return {
    performanceScore: performance.lighthouse.performanceScore,
    accessibilityScore: performance.lighthouse.accessibilityScore,
    lcpRating: performance.lighthouse.lcp?.score,
    clsRating: performance.lighthouse.cls?.score,
    fcpRating: performance.lighthouse.fcp?.score,
    tbtRating: performance.lighthouse.tbt?.score,
    ttfbRating: performance.lighthouse.ttfb?.score,
    totalSizeKb: performance.pageWeight.totalSizeKb,
    totalRequests: performance.pageWeight.totalRequests,
    cachingPresent: performance.caching.present,
    imageOptimized: performance.imageOptimization?.optimized,
    thirdPartyPercent: performance.thirdParty?.percent,
  };
}

function condenseBusiness(business: BusinessResult): CondensedBusiness {
  return {
    businessName: business.businessName.value,
    hasContactPage: business.hasContactPage,
    hasSupportPage: business.hasSupportPage,
    hasPricing: business.hasPricing,
    hasFreeTrialSignal: business.hasFreeTrialSignal,
    hasEnterpriseSignal: business.hasEnterpriseSignal,
    socialPlatforms: business.socialLinks.map((s) => s.platform),
    hasSaasSignals: business.businessModel.hasSaasSignals.value,
    hasEcommerceSignals: business.businessModel.hasEcommerceSignals.value,
    hasMarketplaceSignals: business.businessModel.hasMarketplaceSignals.value,
    primaryCta: business.primaryCta,
  };
}

function condenseUx(ux: UxResult): CondensedUx {
  return {
    hasViewportMeta: ux.viewport.hasViewportMeta,
    hasNav: ux.navigation.hasNav,
    hasHamburgerSignal: ux.navigation.hasHamburgerSignal,
    hasSearchForm: ux.forms.hasSearchForm,
    hasLoginForm: ux.forms.hasLoginForm,
    hasNewsletterSignal: ux.forms.hasNewsletterSignal,
    ctaPresent: ux.cta.present,
    hasHeroSection: ux.content.hasHeroSection,
    accessibilityScore: ux.accessibility.score,
    mobileViewportConfigured: ux.mobile?.mobileViewportConfigured,
    touchTargetIssues: ux.mobile?.touchTargetIssues,
    hasReadableLineLength: ux.readingExperience?.hasReadableLineLength,
  };
}

@Injectable()
export class AiInputBuilderService {
  build(
    results: AnalyzerResultsBundle,
    options: { deep: boolean },
  ): AnalysisInput {
    const input: AnalysisInput = {
      analysisType: options.deep ? 'deep' : 'standard',
      technology: condenseTechnology(results.technology),
      seo: compact(condenseSeo(results.seo)) ?? {},
      security: compact(condenseSecurity(results.security)) ?? {},
      performance: compact(condensePerformance(results.performance)) ?? {},
      business: compact(condenseBusiness(results.business)) ?? {},
      ux: compact(condenseUx(results.ux)) ?? {},
    };
    return input;
  }

  /**
   * ai-summary's counterpart to build() - the client supplies `findings`
   * directly (any subset of analyzer output keys, client-controlled and
   * possibly partial/malformed), rather than this service receiving
   * guaranteed-shaped results from analyzers that just ran. Each section is
   * condensed independently behind `safe()` so one missing/malformed key
   * (e.g. `findings.security` present but missing `.https`) only drops that
   * section instead of failing the whole request.
   */
  buildFromFindings(findings: Record<string, any>): AnalysisInput {
    return {
      analysisType: 'standard',
      technology: findings.technology
        ? safe(() => condenseTechnology(findings.technology as TechnologyResult), [])
        : [],
      seo: findings.seo
        ? safe(() => compact(condenseSeo(findings.seo as SeoResult)) ?? {}, {})
        : {},
      security: findings.security
        ? safe(
            () => compact(condenseSecurity(findings.security as SecurityResult)) ?? {},
            {},
          )
        : {},
      performance: findings.performance
        ? safe(
            () =>
              compact(condensePerformance(findings.performance as PerformanceResult)) ??
              {},
            {},
          )
        : {},
      business: findings.business
        ? safe(
            () => compact(condenseBusiness(findings.business as BusinessResult)) ?? {},
            {},
          )
        : {},
      ux: findings.ux
        ? safe(() => compact(condenseUx(findings.ux as UxResult)) ?? {}, {})
        : {},
    };
  }
}
