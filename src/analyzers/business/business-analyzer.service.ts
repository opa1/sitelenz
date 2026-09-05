import { Injectable } from '@nestjs/common';
import type {
  MetaTag,
  RawObservations,
} from '../../common/browser/raw-observations.interface';
import type { Analyzer, AnalyzerOptions } from '../analyzer.interface';
import { loadHtml, type CheerioAPI } from '../../common/utils/html.util';
import { createSafe } from '../../common/utils/analyzer-safety.util';

const safe = createSafe('business');
import type {
  BusinessModelSignals,
  BusinessResult,
  NavLink,
  SocialLink,
  SourcedValue,
} from './business-result.interface';

const CTA_CLASS_PATTERN = /\b(btn|cta)\b/i;
const PRICE_PATTERN = /\$\s?\d|per\s+(month|year)|\/mo\b|\/yr\b|\bpricing\b/i;

const SOCIAL_PLATFORMS: { platform: string; hosts: string[] }[] = [
  { platform: 'twitter', hosts: ['twitter.com', 'x.com'] },
  { platform: 'linkedin', hosts: ['linkedin.com'] },
  { platform: 'github', hosts: ['github.com'] },
  { platform: 'facebook', hosts: ['facebook.com'] },
  { platform: 'instagram', hosts: ['instagram.com'] },
  { platform: 'youtube', hosts: ['youtube.com'] },
  { platform: 'tiktok', hosts: ['tiktok.com'] },
];

function getMetaContent(
  $: CheerioAPI,
  metaTags: MetaTag[],
  name: string,
): string | null {
  const fromTags = metaTags.find(
    (m) => m.name?.toLowerCase() === name.toLowerCase(),
  )?.content;
  if (fromTags) return fromTags;
  return $(`meta[name="${name}"]`).attr('content') ?? null;
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
  return $(`meta[property="${property}"]`).attr('content') ?? null;
}

function extractOrganizationName($: CheerioAPI): string | null {
  let name: string | null = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (name) return;
    try {
      const parsed: unknown = JSON.parse($(el).contents().text());
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const candidate of candidates) {
        if (candidate && typeof candidate === 'object') {
          const obj = candidate as Record<string, unknown>;
          if (
            typeof obj['@type'] === 'string' &&
            obj['@type'].toLowerCase() === 'organization' &&
            typeof obj.name === 'string'
          ) {
            name = obj.name;
            break;
          }
        }
      }
    } catch {
      // ignore malformed structured data
    }
  });
  return name;
}

function extractBusinessName(
  $: CheerioAPI,
  metaTags: MetaTag[],
  observations: RawObservations,
): SourcedValue<string | null> {
  const ogSiteName = getMetaProperty($, metaTags, 'og:site_name');
  if (ogSiteName) return { value: ogSiteName, source: 'observed' };

  const appName = getMetaContent($, metaTags, 'application-name');
  if (appName) return { value: appName, source: 'observed' };

  const orgName = safe(() => extractOrganizationName($), null);
  if (orgName) return { value: orgName, source: 'observed' };

  const title = observations.title?.trim();
  if (title) return { value: title, source: 'inferred' };

  const h1 = $('h1').first().text().trim();
  if (h1) return { value: h1, source: 'inferred' };

  return { value: null, source: 'unknown' };
}

function extractEmails($: CheerioAPI): string[] {
  const emails = new Set<string>();
  $('a[href^="mailto:"]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    const email = href
      .replace(/^mailto:/i, '')
      .split('?')[0]
      .trim();
    if (email) emails.add(email);
  });
  return [...emails];
}

function extractPhones($: CheerioAPI): string[] {
  const phones = new Set<string>();
  $('a[href^="tel:"]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    const phone = href.replace(/^tel:/i, '').trim();
    if (phone) phones.add(phone);
  });
  return [...phones];
}

function extractSocialLinks($: CheerioAPI): SocialLink[] {
  const found = new Map<string, SocialLink>();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    const hostname = safe(
      () => new URL(href, 'https://placeholder.invalid').hostname.toLowerCase(),
      '',
    );
    if (!hostname) return;
    for (const { platform, hosts } of SOCIAL_PLATFORMS) {
      if (hosts.some((h) => hostname === h || hostname.endsWith(`.${h}`))) {
        if (!found.has(href)) found.set(href, { platform, url: href });
        break;
      }
    }
  });
  return [...found.values()];
}

function hasLinkMatching($: CheerioAPI, patterns: string[]): boolean {
  let found = false;
  $('a[href]').each((_, el) => {
    if (found) return;
    const href = ($(el).attr('href') ?? '').toLowerCase();
    if (patterns.some((p) => href.includes(p))) found = true;
  });
  return found;
}

function getBodyText($: CheerioAPI): string {
  return $('body').text().replace(/\s+/g, ' ').trim();
}

function findPrimaryCta($: CheerioAPI): {
  text: string | null;
  url: string | null;
} {
  const el = $('a, button')
    .filter((_, node) => CTA_CLASS_PATTERN.test($(node).attr('class') ?? ''))
    .first();
  if (el.length === 0) return { text: null, url: null };
  const text = el.text().trim() || null;
  const url = el.is('a') ? (el.attr('href') ?? null) : null;
  return { text, url };
}

function findAllCtaTexts($: CheerioAPI): string[] {
  const texts = new Set<string>();
  $('a, button').each((_, node) => {
    if (texts.size >= 20) return false;
    const cls = $(node).attr('class') ?? '';
    if (!CTA_CLASS_PATTERN.test(cls)) return undefined;
    const text = $(node).text().trim();
    if (text) texts.add(text);
    return undefined;
  });
  return [...texts];
}

function findPricingLinks($: CheerioAPI): string[] {
  const links = new Set<string>();
  $('a[href*="/pricing" i]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) links.add(href);
  });
  return [...links];
}

function findLinksIn($: CheerioAPI, selector: string, cap: number): NavLink[] {
  const links: NavLink[] = [];
  const seen = new Set<string>();
  $(selector).each((_, el) => {
    if (links.length >= cap) return false;
    const text = $(el).text().trim();
    const href = $(el).attr('href') ?? '';
    if (!text || !href) return undefined;
    const key = `${text}|${href}`;
    if (seen.has(key)) return undefined;
    seen.add(key);
    links.push({ text, href });
    return undefined;
  });
  return links;
}

function findProductNames($: CheerioAPI): string[] {
  const names = new Set<string>();
  $('[class*="product" i], [class*="feature" i], [class*="solution" i]').each(
    (_, section) => {
      if (names.size >= 10) return false;
      $(section)
        .find('h2, h3')
        .each((_idx, heading) => {
          if (names.size >= 10) return false;
          const text = $(heading).text().trim();
          if (text) names.add(text);
          return undefined;
        });
      return undefined;
    },
  );
  return [...names].slice(0, 10);
}

function buildBusinessModel(
  $: CheerioAPI,
  bodyTextLower: string,
  hasPricing: boolean,
  hasFreeTrialSignal: boolean,
): BusinessModelSignals {
  const hasSaasSignals =
    hasPricing &&
    hasFreeTrialSignal &&
    /\b(software|platform|saas|dashboard)\b/i.test(bodyTextLower);

  const htmlLower = safe(() => $.html().toLowerCase(), '');
  const hasEcommerceSignals =
    /shopify|woocommerce/.test(htmlLower) ||
    hasLinkMatching($, ['/cart', '/shop', '/checkout']) ||
    /add to cart/i.test(bodyTextLower);

  const hasMarketplaceSignals =
    /\b(marketplace|sellers|vendors|become a seller|sell on)\b/i.test(
      bodyTextLower,
    );

  return {
    hasSaasSignals: { value: hasSaasSignals, source: 'inferred' },
    hasEcommerceSignals: { value: hasEcommerceSignals, source: 'inferred' },
    hasMarketplaceSignals: { value: hasMarketplaceSignals, source: 'inferred' },
  };
}

@Injectable()
export class BusinessAnalyzerService implements Analyzer {
  analyze(
    observations: RawObservations,
    options: AnalyzerOptions,
  ): Promise<BusinessResult> {
    const $ = safe(() => loadHtml(observations.html), null);
    if (!$) {
      return Promise.resolve({
        businessName: { value: null, source: 'unknown' },
        pageTitle: observations.title ?? '',
        description: { value: null, source: 'unknown' },
        language: null,
        email: [],
        phone: [],
        socialLinks: [],
        hasContactPage: false,
        hasSupportPage: false,
        hasPricing: false,
        hasFreeTrialSignal: false,
        hasEnterpriseSignal: false,
        primaryCta: null,
        ctaUrl: null,
        businessModel: {
          hasSaasSignals: { value: false, source: 'inferred' },
          hasEcommerceSignals: { value: false, source: 'inferred' },
          hasMarketplaceSignals: { value: false, source: 'inferred' },
        },
      });
    }

    const bodyText = safe(() => getBodyText($), '');
    const bodyTextLower = bodyText.toLowerCase();

    const hasPricing = safe(
      () => hasLinkMatching($, ['/pricing']) || PRICE_PATTERN.test(bodyText),
      false,
    );
    const hasFreeTrialSignal = safe(
      () => /free trial|try free|start free/i.test(bodyTextLower),
      false,
    );
    const hasEnterpriseSignal = safe(
      () => /enterprise|custom pricing|contact sales/i.test(bodyTextLower),
      false,
    );

    const primaryCta = safe(() => findPrimaryCta($), {
      text: null,
      url: null,
    });

    const result: BusinessResult = {
      businessName: safe(
        () => extractBusinessName($, observations.metaTags, observations),
        { value: null, source: 'unknown' },
      ),
      pageTitle: observations.title ?? '',
      description: safe(
        () => {
          const value = getMetaContent($, observations.metaTags, 'description');
          return {
            value,
            source: value ? ('observed' as const) : ('unknown' as const),
          };
        },
        { value: null, source: 'unknown' },
      ),
      language: safe(() => $('html').attr('lang') ?? null, null),
      email: safe(() => extractEmails($), []),
      phone: safe(() => extractPhones($), []),
      socialLinks: safe(() => extractSocialLinks($), []),
      hasContactPage: safe(
        () => hasLinkMatching($, ['/contact-us', '/contact', '/get-in-touch']),
        false,
      ),
      hasSupportPage: safe(
        () => hasLinkMatching($, ['/support', '/help', '/faq']),
        false,
      ),
      hasPricing,
      hasFreeTrialSignal,
      hasEnterpriseSignal,
      primaryCta: primaryCta.text,
      ctaUrl: primaryCta.url,
      businessModel: safe(
        () =>
          buildBusinessModel($, bodyTextLower, hasPricing, hasFreeTrialSignal),
        {
          hasSaasSignals: { value: false, source: 'inferred' },
          hasEcommerceSignals: { value: false, source: 'inferred' },
          hasMarketplaceSignals: { value: false, source: 'inferred' },
        },
      ),
    };

    if (options.deep) {
      result.allCtaTexts = safe(() => findAllCtaTexts($), []);
      result.pricingLinks = safe(() => findPricingLinks($), []);
      result.navLinks = safe(
        () => findLinksIn($, 'nav a[href], header a[href]', 20),
        [],
      );
      result.footerLinks = safe(() => findLinksIn($, 'footer a[href]', 30), []);
      result.productNames = {
        value: safe(() => findProductNames($), []),
        source: 'inferred',
      };
    }

    return Promise.resolve(result);
  }
}
