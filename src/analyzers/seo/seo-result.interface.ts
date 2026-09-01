export type TitleIssue = 'too_short' | 'too_long' | 'missing';

export interface SeoTitle {
  present: boolean;
  value: string | null;
  length: number;
  issues: TitleIssue[];
}

export type MetaDescriptionIssue = 'too_short' | 'too_long' | 'missing';

export interface SeoMetaDescription {
  present: boolean;
  value: string | null;
  length: number;
  issues: MetaDescriptionIssue[];
}

export interface SeoCanonical {
  present: boolean;
  value: string | null;
  matchesCurrentUrl: boolean;
}

export interface RobotsDirectives {
  noindex: boolean;
  nofollow: boolean;
  noarchive: boolean;
}

export interface SeoRobots {
  meta: RobotsDirectives | null;
  header: RobotsDirectives | null;
  indexable: boolean;
}

export interface OgField {
  present: boolean;
  value: string | null;
}

export interface SeoOpenGraph {
  title: OgField;
  description: OgField;
  image: OgField;
  type: OgField;
  url: OgField;
  complete: boolean;
}

export type TwitterCardType =
  'summary' | 'summary_large_image' | 'app' | 'player' | 'unknown';

export interface SeoTwitterCard {
  card: OgField;
  title: OgField;
  description: OgField;
  image: OgField;
  cardType: TwitterCardType;
}

export type HeadingIssue = 'missing_h1' | 'multiple_h1' | 'skipped_levels';

export interface SeoHeadings {
  h1Count: number;
  h2Count: number;
  h1Values: string[];
  issues: HeadingIssue[];
}

export interface SeoImages {
  total: number;
  withAlt: number;
  withEmptyAlt: number;
  missingAlt: number;
  altCoveragePercent: number;
}

export interface StructuredDataItem {
  type: string | null;
  valid: boolean;
  raw: unknown;
}

export interface SeoStructuredData {
  items: StructuredDataItem[];
  types: string[];
}

export interface SeoRobotsTxt {
  present: boolean;
  allowsIndexing: boolean;
  disallowedPaths: string[];
  hasSitemapReference: boolean;
}

export interface SeoSitemap {
  present: boolean;
  url: string | null;
  entryCount: number | null;
}

export interface SeoHreflang {
  present: boolean;
  languages: string[];
}

export interface SeoResult {
  title: SeoTitle;
  metaDescription: SeoMetaDescription;
  canonical: SeoCanonical;
  robots: SeoRobots;
  openGraph: SeoOpenGraph;
  twitterCard: SeoTwitterCard;
  headings: SeoHeadings;
  images: SeoImages;
  structuredData: SeoStructuredData;
  lighthouseSeoScore: number | null;
  robotsTxt?: SeoRobotsTxt;
  sitemap?: SeoSitemap;
  hreflang?: SeoHreflang;
}
