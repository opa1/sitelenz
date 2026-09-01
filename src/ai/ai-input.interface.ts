export interface CondensedTechnology {
  name: string;
  category: string;
}

export interface CondensedSeo {
  lighthouseSeoScore?: number | null;
  titlePresent?: boolean;
  titleIssues?: string[];
  metaDescriptionPresent?: boolean;
  metaDescriptionIssues?: string[];
  canonicalPresent?: boolean;
  canonicalMatchesCurrentUrl?: boolean;
  robotsIndexable?: boolean;
  openGraphComplete?: boolean;
  twitterCardType?: string;
  h1Count?: number;
  headingIssues?: string[];
  imageAltCoveragePercent?: number;
  structuredDataTypes?: string[];
  robotsTxtPresent?: boolean;
  robotsTxtAllowsIndexing?: boolean;
  sitemapPresent?: boolean;
  hreflangPresent?: boolean;
}

export interface CondensedSecurity {
  securityScore?: number;
  httpsEnabled?: boolean;
  mixedContent?: boolean;
  hstsScore?: string;
  cspScore?: string;
  xContentTypeOptionsCorrect?: boolean;
  xFrameOptionsScore?: string;
  referrerPolicyScore?: string;
  permissionsPolicyPresent?: boolean;
  cookieIssues?: string[];
  tlsValid?: boolean;
  tlsDaysUntilExpiry?: number | null;
}

export interface CondensedPerformance {
  performanceScore?: number | null;
  accessibilityScore?: number | null;
  lcpRating?: string;
  clsRating?: string;
  fcpRating?: string;
  tbtRating?: string;
  ttfbRating?: string;
  totalSizeKb?: number;
  totalRequests?: number;
  cachingPresent?: boolean;
  imageOptimized?: boolean;
  thirdPartyPercent?: number;
}

export interface CondensedBusiness {
  businessName?: string | null;
  hasContactPage?: boolean;
  hasSupportPage?: boolean;
  hasPricing?: boolean;
  hasFreeTrialSignal?: boolean;
  hasEnterpriseSignal?: boolean;
  socialPlatforms?: string[];
  hasSaasSignals?: boolean;
  hasEcommerceSignals?: boolean;
  hasMarketplaceSignals?: boolean;
  primaryCta?: string | null;
}

export interface CondensedUx {
  hasViewportMeta?: boolean;
  hasNav?: boolean;
  hasHamburgerSignal?: boolean;
  hasSearchForm?: boolean;
  hasLoginForm?: boolean;
  hasNewsletterSignal?: boolean;
  ctaPresent?: boolean;
  hasHeroSection?: boolean;
  accessibilityScore?: number | null;
  mobileViewportConfigured?: boolean;
  touchTargetIssues?: boolean;
  hasReadableLineLength?: boolean;
}

export interface AnalysisInput {
  analysisType: 'standard' | 'deep';
  technology: CondensedTechnology[];
  seo: CondensedSeo;
  security: CondensedSecurity;
  performance: CondensedPerformance;
  business: CondensedBusiness;
  ux: CondensedUx;
}
