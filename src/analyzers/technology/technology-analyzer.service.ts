import { Injectable } from '@nestjs/common';
import type { RawObservations } from '../../common/browser/raw-observations.interface';
import type { Analyzer, AnalyzerOptions } from '../analyzer.interface';
import { loadHtml, type CheerioAPI } from '../../common/utils/html.util';
import { getHeader } from '../../common/utils/headers.util';
import { createSafe } from '../../common/utils/analyzer-safety.util';

const safe = createSafe('technology');
import type {
  AdditionalLibrary,
  DetectedTechnology,
  TechnologyCategory,
  TechnologyResult,
} from './technology-result.interface';

interface DetectionContext {
  $: CheerioAPI;
  htmlLower: string;
  scriptSrcsLower: string[];
  inlineScriptLower: string;
  windowKeys: Set<string>;
  headers: Record<string, string>;
  headerKeysLower: string[];
  networkUrlsLower: string[];
  finalUrlLower: string;
  metaGenerator: string;
}

type Check = (ctx: DetectionContext) => string | null;

interface TechDefinition {
  name: string;
  category: TechnologyCategory;
  checks: Check[];
}

const hasWindowKey =
  (key: string): Check =>
  (ctx) =>
    ctx.windowKeys.has(key) ? `window.${key} detected` : null;

const hasWindowKeyPrefix =
  (prefix: string): Check =>
  (ctx) => {
    const match = [...ctx.windowKeys].find((k) =>
      k.toLowerCase().startsWith(prefix.toLowerCase()),
    );
    return match ? `window.${match} detected` : null;
  };

const scriptSrcIncludes =
  (needle: string): Check =>
  (ctx) => {
    const match = ctx.scriptSrcsLower.find((s) =>
      s.includes(needle.toLowerCase()),
    );
    return match ? `script src contains "${needle}"` : null;
  };

const htmlIncludes =
  (needle: string): Check =>
  (ctx) =>
    ctx.htmlLower.includes(needle.toLowerCase())
      ? `HTML contains "${needle}"`
      : null;

const htmlMatches =
  (pattern: RegExp, label: string): Check =>
  (ctx) =>
    pattern.test(ctx.htmlLower) ? label : null;

const networkIncludes =
  (needle: string): Check =>
  (ctx) => {
    const match = ctx.networkUrlsLower.find((u) =>
      u.includes(needle.toLowerCase()),
    );
    return match ? `network request contains "${needle}"` : null;
  };

const finalUrlIncludes =
  (needle: string): Check =>
  (ctx) =>
    ctx.finalUrlLower.includes(needle.toLowerCase())
      ? `page URL contains "${needle}"`
      : null;

const headerPresent =
  (name: string): Check =>
  (ctx) =>
    getHeader(ctx.headers, name) !== null
      ? `"${name}" response header present`
      : null;

const headerPrefixPresent =
  (prefix: string): Check =>
  (ctx) => {
    const match = ctx.headerKeysLower.find((k) =>
      k.startsWith(prefix.toLowerCase()),
    );
    return match ? `"${match}" response header present` : null;
  };

const inlineScriptMatches =
  (pattern: RegExp, label: string): Check =>
  (ctx) =>
    pattern.test(ctx.inlineScriptLower) ? label : null;

const inlineScriptIncludes =
  (needle: string): Check =>
  (ctx) =>
    ctx.inlineScriptLower.includes(needle.toLowerCase())
      ? `inline script contains "${needle}"`
      : null;

const metaGeneratorIncludes =
  (needle: string): Check =>
  (ctx) =>
    ctx.metaGenerator.includes(needle.toLowerCase())
      ? `meta generator tag mentions "${needle}"`
      : null;

const linkHrefIncludes =
  (needle: string): Check =>
  (ctx) => {
    let found: string | null = null;
    ctx.$('link[href]').each((_, el) => {
      if (found) return;
      const href = (ctx.$(el).attr('href') ?? '').toLowerCase();
      if (href.includes(needle.toLowerCase())) {
        found = `link href contains "${needle}"`;
      }
    });
    return found;
  };

const TECH_DEFINITIONS: TechDefinition[] = [
  // Frameworks
  {
    name: 'Next.js',
    category: 'framework',
    checks: [
      hasWindowKey('__NEXT_DATA__'),
      scriptSrcIncludes('/_next/'),
      htmlIncludes('id="__next"'),
    ],
  },
  {
    name: 'React',
    category: 'framework',
    checks: [
      hasWindowKey('__REACT_DEVTOOLS_GLOBAL_HOOK__'),
      scriptSrcIncludes('react.development.js'),
      scriptSrcIncludes('react.production.min.js'),
      htmlIncludes('data-reactroot'),
    ],
  },
  {
    name: 'Vue',
    category: 'framework',
    checks: [
      hasWindowKey('__vue_app__'),
      scriptSrcIncludes('vue.runtime'),
      htmlMatches(
        /<div[^>]*id=["']app["'][^>]*\sv-[a-z-]+=/i,
        'HTML has <div id="app"> with a v- directive',
      ),
    ],
  },
  {
    name: 'Nuxt',
    category: 'framework',
    checks: [hasWindowKeyPrefix('__nuxt'), scriptSrcIncludes('/_nuxt/')],
  },
  {
    name: 'Angular',
    category: 'framework',
    checks: [htmlIncludes('ng-version'), scriptSrcIncludes('angular.min.js')],
  },
  {
    name: 'Svelte',
    category: 'framework',
    checks: [
      hasWindowKeyPrefix('__svelte'),
      scriptSrcIncludes('svelte/internal'),
    ],
  },
  {
    name: 'Astro',
    category: 'framework',
    checks: [htmlIncludes('data-astro-cid-'), htmlIncludes('astro-island')],
  },
  {
    name: 'Remix',
    category: 'framework',
    checks: [
      hasWindowKey('__remixContext'),
      htmlMatches(
        /\/build\/[^"']*remix/i,
        'script src under /build/ mentions remix',
      ),
    ],
  },
  {
    name: 'SvelteKit',
    category: 'framework',
    checks: [hasWindowKeyPrefix('__sveltekit')],
  },

  // CMS
  {
    name: 'WordPress',
    category: 'cms',
    checks: [
      htmlIncludes('/wp-content/'),
      htmlIncludes('/wp-includes/'),
      metaGeneratorIncludes('wordpress'),
      networkIncludes('wp-json'),
    ],
  },
  {
    name: 'Shopify',
    category: 'cms',
    checks: [
      hasWindowKey('Shopify'),
      networkIncludes('cdn.shopify.com'),
      finalUrlIncludes('myshopify.com'),
    ],
  },
  {
    name: 'Webflow',
    category: 'cms',
    checks: [
      hasWindowKeyPrefix('webflow'),
      networkIncludes('assets.website-files.com'),
      htmlIncludes('data-wf-domain'),
    ],
  },
  {
    name: 'Wix',
    category: 'cms',
    checks: [scriptSrcIncludes('wix.com'), hasWindowKeyPrefix('_wix')],
  },
  {
    name: 'Squarespace',
    category: 'cms',
    checks: [scriptSrcIncludes('squarespace.com'), hasWindowKey('Static')],
  },
  {
    name: 'Ghost',
    category: 'cms',
    checks: [metaGeneratorIncludes('ghost')],
  },

  // Infrastructure
  {
    name: 'Vercel',
    category: 'infrastructure',
    checks: [
      headerPresent('x-vercel-id'),
      finalUrlIncludes('vercel.app'),
      scriptSrcIncludes('_vercel'),
    ],
  },
  {
    name: 'Netlify',
    category: 'infrastructure',
    checks: [headerPresent('x-nf-request-id'), finalUrlIncludes('netlify.app')],
  },
  {
    name: 'Cloudflare',
    category: 'infrastructure',
    checks: [headerPresent('cf-ray'), headerPresent('cf-cache-status')],
  },
  {
    name: 'AWS',
    category: 'infrastructure',
    checks: [
      headerPrefixPresent('x-amz-'),
      networkIncludes('amazonaws.com'),
      networkIncludes('cloudfront.net'),
    ],
  },
  {
    name: 'GitHub Pages',
    category: 'infrastructure',
    checks: [headerPresent('x-github-request-id')],
  },
  {
    name: 'Fastly',
    category: 'infrastructure',
    checks: [headerPresent('x-served-by')],
  },
  {
    name: 'Google Cloud',
    category: 'infrastructure',
    checks: [headerPrefixPresent('x-goog-')],
  },

  // Analytics
  {
    name: 'Google Analytics 4',
    category: 'analytics',
    checks: [
      inlineScriptMatches(
        /gtag\(\s*['"]config['"]\s*,\s*['"]g-/i,
        "inline script calls gtag('config', 'G-...')",
      ),
      networkIncludes('google-analytics.com/g/'),
    ],
  },
  {
    name: 'Google Tag Manager',
    category: 'analytics',
    checks: [scriptSrcIncludes('googletagmanager.com/gtm.js')],
  },
  {
    name: 'Plausible',
    category: 'analytics',
    checks: [scriptSrcIncludes('plausible.io/js/')],
  },
  {
    name: 'Mixpanel',
    category: 'analytics',
    checks: [
      inlineScriptIncludes('mixpanel.init'),
      networkIncludes('api.mixpanel.com'),
    ],
  },
  {
    name: 'PostHog',
    category: 'analytics',
    checks: [
      inlineScriptIncludes('posthog.init'),
      networkIncludes('app.posthog.com'),
    ],
  },
  {
    name: 'Hotjar',
    category: 'analytics',
    checks: [scriptSrcIncludes('hotjar.com'), networkIncludes('hotjar.com')],
  },
  {
    name: 'Segment',
    category: 'analytics',
    checks: [scriptSrcIncludes('cdn.segment.com')],
  },

  // Payments
  {
    name: 'Stripe',
    category: 'payments',
    checks: [
      scriptSrcIncludes('js.stripe.com'),
      inlineScriptMatches(/stripe\s*\(/i, 'inline script calls Stripe()'),
    ],
  },
  {
    name: 'PayPal',
    category: 'payments',
    checks: [scriptSrcIncludes('paypal.com/sdk')],
  },
  {
    name: 'Paddle',
    category: 'payments',
    checks: [scriptSrcIncludes('paddle.com/js')],
  },
  {
    name: 'Lemon Squeezy',
    category: 'payments',
    checks: [scriptSrcIncludes('lemonsqueezy.com')],
  },

  // CSS frameworks
  {
    name: 'Bootstrap',
    category: 'css-framework',
    checks: [
      scriptSrcIncludes('bootstrap.min.css'),
      scriptSrcIncludes('bootstrap.bundle'),
      htmlIncludes('bootstrap.min.css'),
    ],
  },
  {
    name: 'Chakra UI',
    category: 'css-framework',
    checks: [scriptSrcIncludes('chakra-ui')],
  },
  {
    name: 'Material UI',
    category: 'css-framework',
    checks: [scriptSrcIncludes('@mui')],
  },

  // Fonts
  {
    name: 'Google Fonts',
    category: 'font',
    checks: [
      networkIncludes('fonts.googleapis.com'),
      linkHrefIncludes('fonts.googleapis.com'),
    ],
  },
  {
    name: 'Typekit / Adobe Fonts',
    category: 'font',
    checks: [scriptSrcIncludes('use.typekit.net')],
  },
  {
    name: 'Bunny Fonts',
    category: 'font',
    checks: [
      networkIncludes('fonts.bunny.net'),
      scriptSrcIncludes('fonts.bunny.net'),
    ],
  },
];

const LIBRARY_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: 'jQuery', pattern: /jquery[@/.-]?v?(\d+(?:\.\d+){0,2})?/i },
  { name: 'Lodash', pattern: /lodash[@/.-]?v?(\d+(?:\.\d+){0,2})?/i },
  {
    name: 'Underscore.js',
    pattern: /underscore[@/.-]?v?(\d+(?:\.\d+){0,2})?/i,
  },
  { name: 'Axios', pattern: /axios[@/.-]?v?(\d+(?:\.\d+){0,2})?/i },
  { name: 'Moment.js', pattern: /moment[@/.-]?v?(\d+(?:\.\d+){0,2})?/i },
  { name: 'Day.js', pattern: /dayjs[@/.-]?v?(\d+(?:\.\d+){0,2})?/i },
  {
    name: 'D3.js',
    pattern: /\bd3[@/.-]?v?(\d+(?:\.\d+){0,2})?\.(?:min\.)?js/i,
  },
  {
    name: 'Three.js',
    pattern: /three[@/.-]?v?(\d+(?:\.\d+){0,2})?\.(?:min\.)?js/i,
  },
  { name: 'Chart.js', pattern: /chart\.js[@/.-]?v?(\d+(?:\.\d+){0,2})?/i },
  { name: 'Alpine.js', pattern: /alpinejs[@/.-]?v?(\d+(?:\.\d+){0,2})?/i },
  { name: 'htmx', pattern: /htmx(?:\.org)?[@/.-]?v?(\d+(?:\.\d+){0,2})?/i },
  { name: 'Redux', pattern: /\bredux[@/.-]?v?(\d+(?:\.\d+){0,2})?/i },
  { name: 'GSAP', pattern: /\bgsap[@/.-]?v?(\d+(?:\.\d+){0,2})?/i },
  { name: 'Swiper', pattern: /\bswiper[@/.-]?v?(\d+(?:\.\d+){0,2})?/i },
  {
    name: 'Popper.js',
    pattern: /popper(?:\.js)?[@/.-]?v?(\d+(?:\.\d+){0,2})?/i,
  },
];

function buildContext(observations: RawObservations): DetectionContext {
  const $ = loadHtml(observations.html);
  const htmlLower = observations.html.toLowerCase();
  const scriptSrcsLower = observations.scripts
    .filter((s) => !s.inline && s.src)
    .map((s) => (s.src ?? '').toLowerCase());
  const inlineScriptLower = observations.scripts
    .filter((s) => s.inline && s.content)
    .map((s) => (s.content ?? '').toLowerCase())
    .join('\n');
  const windowKeys = new Set(observations.windowKeys);
  const networkUrlsLower = observations.networkRequests.map((r) =>
    r.url.toLowerCase(),
  );
  const headerKeysLower = Object.keys(observations.responseHeaders).map((k) =>
    k.toLowerCase(),
  );
  const metaGenerator = (
    observations.metaTags.find((m) => m.name?.toLowerCase() === 'generator')
      ?.content ?? ''
  ).toLowerCase();

  return {
    $,
    htmlLower,
    scriptSrcsLower,
    inlineScriptLower,
    windowKeys,
    headers: observations.responseHeaders,
    headerKeysLower,
    networkUrlsLower,
    finalUrlLower: observations.url.toLowerCase(),
    metaGenerator,
  };
}

function detectOne(
  def: TechDefinition,
  ctx: DetectionContext,
): DetectedTechnology | null {
  const evidence: string[] = [];
  for (const check of def.checks) {
    const hit = safe(() => check(ctx), null);
    if (hit) evidence.push(hit);
  }
  if (evidence.length === 0) return null;
  return {
    name: def.name,
    category: def.category,
    confidence: Math.min(0.6 + evidence.length * 0.15, 0.97),
    evidence,
  };
}

const TAILWIND_CLASS_PATTERN = /(^|\s)(bg-[\w-]+|text-[\w-]+|flex|grid)(\s|$)/;

function detectTailwind(ctx: DetectionContext): DetectedTechnology | null {
  let matched = 0;
  let sampled = 0;
  const evidence: string[] = [];
  ctx.$('[class]').each((_, el) => {
    if (sampled >= 50) return false;
    sampled += 1;
    const cls = ctx.$(el).attr('class') ?? '';
    if (TAILWIND_CLASS_PATTERN.test(cls)) {
      matched += 1;
      if (evidence.length < 3) evidence.push(`class="${cls}"`);
    }
    return undefined;
  });

  const scriptHit = ctx.scriptSrcsLower.some((s) => s.includes('tailwind'));
  if (scriptHit) evidence.push('script filename mentions "tailwind"');

  if (matched < 3 && !scriptHit) return null;

  return {
    name: 'Tailwind CSS',
    category: 'css-framework',
    confidence: Math.min(0.6 + matched * 0.05 + (scriptHit ? 0.2 : 0), 0.97),
    evidence,
  };
}

function detectAdditionalLibraries(
  observations: RawObservations,
  alreadyDetected: Set<string>,
): AdditionalLibrary[] {
  const results: AdditionalLibrary[] = [];
  const seen = new Set<string>();

  for (const script of observations.scripts) {
    const detectedIn: 'inline' | 'external' = script.inline
      ? 'inline'
      : 'external';
    const haystack = script.inline
      ? (script.content ?? '')
      : (script.src ?? '');
    if (!haystack) continue;

    for (const lib of LIBRARY_PATTERNS) {
      if (alreadyDetected.has(lib.name.toLowerCase())) continue;
      const dedupeKey = `${lib.name}:${detectedIn}`;
      if (seen.has(dedupeKey)) continue;

      const match = safe(() => haystack.match(lib.pattern), null);
      if (!match) continue;

      seen.add(dedupeKey);
      results.push({
        name: lib.name,
        version: match[1] || undefined,
        detectedIn,
      });
    }
  }

  return results;
}

@Injectable()
export class TechnologyAnalyzerService implements Analyzer {
  analyze(
    observations: RawObservations,
    options: AnalyzerOptions,
  ): Promise<TechnologyResult> {
    const ctx = safe(() => buildContext(observations), null);
    if (!ctx) {
      return Promise.resolve({ technologies: [] });
    }

    const technologies: DetectedTechnology[] = [];
    for (const def of TECH_DEFINITIONS) {
      const found = safe(() => detectOne(def, ctx), null);
      if (found) technologies.push(found);
    }

    const tailwind = safe(() => detectTailwind(ctx), null);
    if (tailwind) technologies.push(tailwind);

    const result: TechnologyResult = { technologies };

    if (options.deep) {
      const detectedNames = new Set(
        technologies.map((t) => t.name.toLowerCase()),
      );
      result.additionalLibraries = safe(
        () => detectAdditionalLibraries(observations, detectedNames),
        [],
      );
    }

    return Promise.resolve(result);
  }
}
