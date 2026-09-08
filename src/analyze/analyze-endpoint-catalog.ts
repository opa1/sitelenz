import type { AnalyzeEndpoint } from './analyze-job.interface';
import {
  ANALYZE_AI_SUMMARY_PRICE_USD,
  ANALYZE_FULL_PRICE_USD,
  ANALYZE_HEAVY_PRICE_USD,
  ANALYZE_LIGHTWEIGHT_PRICE_USD,
  ANALYZE_PERFORMANCE_PRICE_USD,
  ANALYZE_STANDARD_PRICE_USD,
} from '../x402/x402.constants';

export interface AnalyzeEndpointCatalogEntry {
  name: AnalyzeEndpoint;
  description: string;
  price: number;
}

/**
 * Single source of truth for every /v1/analyze/* endpoint's price and
 * description - consumed by both the .well-known/x402 Bazaar manifest
 * (well-known.controller.ts) and the GET /v1/analyze discovery catalog
 * (discovery.controller.ts) so the two can't drift out of sync.
 */
export const ANALYZE_ENDPOINT_CATALOG: AnalyzeEndpointCatalogEntry[] = [
  {
    name: 'technology',
    description:
      'Detects frontend frameworks, CMS, CDN, analytics, payment providers, CSS libraries, and fonts from HTTP headers, DOM markers, and script analysis.',
    price: ANALYZE_LIGHTWEIGHT_PRICE_USD,
  },
  {
    name: 'seo',
    description:
      'Inspects title, meta description, canonical, robots directives, Open Graph, Twitter cards, heading structure, image alt coverage, and structured data.',
    price: ANALYZE_LIGHTWEIGHT_PRICE_USD,
  },
  {
    name: 'security',
    description:
      'Audits HTTP security headers (HSTS, CSP, X-Frame-Options, Referrer-Policy), HTTPS status, mixed content, and TLS certificate validity.',
    price: ANALYZE_LIGHTWEIGHT_PRICE_USD,
  },
  {
    name: 'business',
    description:
      'Extracts business name, description, contact info, social links, pricing signals, CTA text, and business model indicators.',
    price: ANALYZE_LIGHTWEIGHT_PRICE_USD,
  },
  {
    name: 'performance',
    description:
      'Runs a full Lighthouse audit and Playwright session to collect Core Web Vitals (LCP, CLS, FCP, TBT, TTFB), page weight, resource inventory, and third-party domain analysis.',
    price: ANALYZE_PERFORMANCE_PRICE_USD,
  },
  {
    name: 'ux-accessibility',
    description:
      'Evaluates mobile viewport configuration, navigation structure, form detection, CTA presence, reading metrics, and Lighthouse accessibility audit scores.',
    price: ANALYZE_HEAVY_PRICE_USD,
  },
  {
    name: 'screenshots',
    description:
      'Captures full desktop (1280x720) and mobile (390x844) viewport screenshots via headless Chromium and returns Cloudinary-hosted image URLs.',
    price: ANALYZE_HEAVY_PRICE_USD,
  },
  {
    name: 'ai-summary',
    description:
      'Accepts structured website analyzer findings and returns an AI-generated executive summary, strengths, weaknesses, notable findings, and prioritized recommendations.',
    price: ANALYZE_AI_SUMMARY_PRICE_USD,
  },
  {
    name: 'standard',
    description:
      'Runs a full website analysis covering technology stack, SEO, security headers, performance metrics, business signals, and UX - with a desktop screenshot and AI interpretation.',
    price: ANALYZE_STANDARD_PRICE_USD,
  },
  {
    name: 'full',
    description:
      'Comprehensive deep website analysis with all six analyzers in deep mode, desktop and mobile screenshots, expanded AI interpretation, and additional signals including TLS inspection, JS dependency tree, sitemap, and third-party request analysis.',
    price: ANALYZE_FULL_PRICE_USD,
  },
];
