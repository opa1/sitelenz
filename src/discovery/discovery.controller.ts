import { Controller, Get, Header, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { FastifyReply, FastifyRequest } from 'fastify';

const BASE_URL = 'https://api.sitelenz.online';
const OG_IMAGE_URL = `${BASE_URL}/og-image.png`;
const PRODUCT_NAME = 'SiteLenz';
const PRODUCT_TITLE = 'SiteLenz - Website Intelligence API';
const PRODUCT_DESCRIPTION =
  'SiteLenz is a pay-per-request Website Intelligence API. Give it a URL and get structured analysis of its technology, SEO, security, business, UX/accessibility, performance, screenshots, and more. Built for applications and AI agents, with each request paid in USDC through x402.';

// /.well-known/agent.json and /.well-known/agent-card.json return the same
// document - some agents probe for the -card variant.
const AGENT_CARD = {
  name: PRODUCT_NAME,
  version: '2.0.0',
  description: PRODUCT_DESCRIPTION,
  url: BASE_URL,
  image: OG_IMAGE_URL,
  icon: `${BASE_URL}/logo.png`,
  payment: {
    protocol: 'x402',
    network: 'algorand',
    asset: 'USDC',
  },
  capabilities: [
    'website-analysis',
    'technology-detection',
    'seo-analysis',
    'security-audit',
    'performance-audit',
    'business-intelligence',
    'ux-analysis',
    'screenshots',
    'ai-interpretation',
  ],
  endpoints: {
    discovery: `${BASE_URL}/v1/analyze`,
    openapi: `${BASE_URL}/docs-json`,
    health: `${BASE_URL}/health`,
  },
  pricing: {
    currency: 'USDC',
    min: 0.01,
    max: 0.8,
    model: 'pay-per-request',
  },
};

const LLMS_TXT = `# SiteLenz - Website Intelligence API

${PRODUCT_DESCRIPTION}

## How to use this API

1. Make a POST request to any analysis endpoint
2. You will receive HTTP 402 with a payment challenge
3. Sign an Algorand USDC transaction and retry with X-PAYMENT header
4. You receive an analyzeJobId immediately
5. Poll GET /v1/analyze/{endpoint}/{analyzeJobId} until status is "completed"
6. Fetch result at GET /v1/analyze/{endpoint}/{analyzeJobId}/result

## Endpoint catalog

GET /v1/analyze - returns full catalog with prices

POST /v1/analyze/full - $0.80 - All analyzers deep mode + mobile screenshot + expanded AI
POST /v1/analyze/standard - $0.40 - All analyzers + desktop screenshot + AI summary
POST /v1/analyze/ai-summary - $0.05 - Crawls URL, returns AI executive summary only
POST /v1/analyze/performance - $0.02 - Lighthouse, Core Web Vitals, page weight, third-party analysis
POST /v1/analyze/technology - $0.01 - Framework, CMS, CDN, analytics, payment provider detection
POST /v1/analyze/seo - $0.01 - Meta tags, Open Graph, headings, structured data, robots
POST /v1/analyze/security - $0.01 - Security headers, TLS certificate, HTTPS, mixed content
POST /v1/analyze/business - $0.01 - Business name, contact, social links, pricing signals, CTA
POST /v1/analyze/ux-accessibility - $0.01 - Viewport, navigation, forms, accessibility score
POST /v1/analyze/screenshots - $0.01 - Desktop + mobile screenshots via headless Chromium

## Request format

All endpoints accept:
{ "url": "https://example.com", "webhookUrl": "https://your-server/webhook" }

webhookUrl is optional. If provided, SiteLenz will POST a signed notification when the job completes.

## Response format

Job created: { "analyzeJobId": "sl_aj_...", "status": "queued", "endpoint": "...", "createdAt": "..." }
Job status: { "analyzeJobId": "...", "status": "queued|running|completed|failed", "progressStage": "...", "errorMessage": "..." }
Job result: { "analyzeJobId": "...", "url": "...", "endpoint": "...", "result": {}, "metadata": { "cacheHit": true } }

## Retry failed jobs

POST /v1/analyze/{endpoint}/{analyzeJobId}/retry - no payment required

## Crawl cache

Raw browser observations are cached per URL for 48 hours. Subsequent requests for the same URL reuse the cache - faster completion, same price.

## Network

Testnet and Mainnet supported. Active network: determined by NETWORK env var on the server.
Current network visible at GET /health.

## Documentation

Full OpenAPI spec: ${BASE_URL}/docs-json
Interactive docs: ${BASE_URL}/docs
`;

/**
 * Public, free, unauthenticated discovery endpoints that agents (and the x402
 * Doctor / Bazaar crawlers) probe for. No x402 guard on any of these. The
 * /.well-known/x402 manifest is served separately by WellKnownController and is
 * deliberately not duplicated here.
 */
@ApiExcludeController()
@SkipThrottle({ 'analysis-create': true })
@Controller()
export class DiscoveryController {
  @Get()
  landing(@Req() req: FastifyRequest, @Res() reply: FastifyReply): void {
    if (this.shouldServeHtml(req)) {
      reply
        .header('Content-Type', 'text/html; charset=utf-8')
        .send(this.renderHtmlLanding(req));
      return;
    }

    reply
      .header('Content-Type', 'application/json; charset=utf-8')
      .send(this.getJsonLanding(req));
  }

  private shouldServeHtml(req: FastifyRequest): boolean {
    const query = (req.query as Record<string, unknown>) ?? {};
    if (query['format'] === 'html') {
      return true;
    }
    if (query['format'] === 'json') {
      return false;
    }

    const rawAccept = req.headers['accept'];
    const accept = typeof rawAccept === 'string' ? rawAccept : '';

    const rawUserAgent = req.headers['user-agent'];
    const userAgent = (
      typeof rawUserAgent === 'string' ? rawUserAgent : ''
    ).toLowerCase();

    // Social preview expanders and web crawlers looking for Open Graph tags
    const crawlerPatterns = [
      'facebookexternalhit',
      'twitterbot',
      'linkedinbot',
      'slackbot',
      'discordbot',
      'telegrambot',
      'whatsapp',
      'googlebot',
      'bingbot',
      'applebot',
      'yandex',
      'duckduckbot',
      'baiduspider',
      'embedly',
      'quora link preview',
      'pinterest',
      'vkshare',
      'w3c_validator',
    ];
    if (crawlerPatterns.some((pattern) => userAgent.includes(pattern))) {
      return true;
    }

    // Browsers navigating directly send an Accept header requesting text/html
    if (accept.includes('text/html')) {
      return true;
    }

    return false;
  }

  private getJsonLanding(req?: FastifyRequest) {
    const origin = req ? `${req.protocol}://${req.host}` : BASE_URL;
    return {
      name: PRODUCT_NAME,
      description: PRODUCT_DESCRIPTION,
      version: '2.0.0',
      docs: `${origin}/docs`,
      openapi: `${origin}/docs-json`,
      discovery: `${origin}/v1/analyze`,
      image: OG_IMAGE_URL,
      ogImage: OG_IMAGE_URL,
      payment: 'x402 on Algorand (USDC)',
      endpoints: 10,
    };
  }

  private renderHtmlLanding(req?: FastifyRequest): string {
    const origin = req ? `${req.protocol}://${req.host}` : BASE_URL;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${PRODUCT_TITLE}</title>
  <meta name="description" content="${PRODUCT_DESCRIPTION}">
  <link rel="canonical" href="${origin}/">
  <link rel="icon" type="image/png" href="/logo.png">

  <!-- Open Graph / Facebook / LinkedIn / Discord / Slack -->
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${PRODUCT_NAME}">
  <meta property="og:url" content="${origin}/">
  <meta property="og:title" content="${PRODUCT_TITLE}">
  <meta property="og:description" content="${PRODUCT_DESCRIPTION}">
  <meta property="og:image" content="${OG_IMAGE_URL}">
  <meta property="og:image:secure_url" content="${OG_IMAGE_URL}">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="${PRODUCT_TITLE}">

  <!-- Twitter / X Cards -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:url" content="${origin}/">
  <meta name="twitter:title" content="${PRODUCT_TITLE}">
  <meta name="twitter:description" content="${PRODUCT_DESCRIPTION}">
  <meta name="twitter:image" content="${OG_IMAGE_URL}">
  <meta name="twitter:image:alt" content="${PRODUCT_TITLE}">
</head>
<body>
  <h1>${PRODUCT_NAME}</h1>
  <p>${PRODUCT_DESCRIPTION}</p>
  <p>
    <a href="https://sitelenz.online">Website</a> |
    <a href="/docs">Documentation</a>
  </p>
</body>
</html>`;
  }

  @Get('llms.txt')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  llmsTxt(): string {
    return LLMS_TXT;
  }

  @Get('.well-known/ai-plugin.json')
  aiPlugin() {
    return {
      schema_version: 'v1',
      name_for_human: PRODUCT_NAME,
      name_for_model: 'sitelenz',
      description_for_human: PRODUCT_DESCRIPTION,
      description_for_model:
        `${PRODUCT_DESCRIPTION} All endpoints require x402 payment in USDC on Algorand. Submit a URL to any endpoint, poll for completion, then retrieve structured results. Endpoints range from $0.01 (single analyzer) to $0.80 (full deep analysis). Use GET /v1/analyze to discover all endpoints and prices.`,
      auth: {
        type: 'none',
      },
      api: {
        type: 'openapi',
        url: `${BASE_URL}/docs-json`,
      },
      logo_url: `${BASE_URL}/logo.png`,
      contact_email: 'support@sitelenz.online',
      legal_info_url: BASE_URL,
    };
  }

  @Get('.well-known/agent.json')
  agent() {
    return AGENT_CARD;
  }

  @Get('.well-known/agent-card.json')
  agentCard() {
    return AGENT_CARD;
  }

  @Get('.well-known/mcp.json')
  mcp() {
    return {
      name: 'SiteLenz',
      description: PRODUCT_DESCRIPTION,
      version: '2.0.0',
      protocol: 'x402',
      baseUrl: BASE_URL,
      tools: [
        {
          name: 'analyze_full',
          description: 'Full deep website analysis',
          endpoint: '/v1/analyze/full',
          price: '$0.80',
        },
        {
          name: 'analyze_standard',
          description: 'Standard website analysis',
          endpoint: '/v1/analyze/standard',
          price: '$0.40',
        },
        {
          name: 'analyze_ai_summary',
          description: 'AI executive summary of website',
          endpoint: '/v1/analyze/ai-summary',
          price: '$0.05',
        },
        {
          name: 'analyze_performance',
          description: 'Lighthouse and Core Web Vitals',
          endpoint: '/v1/analyze/performance',
          price: '$0.02',
        },
        {
          name: 'analyze_technology',
          description: 'Technology stack detection',
          endpoint: '/v1/analyze/technology',
          price: '$0.01',
        },
        {
          name: 'analyze_seo',
          description: 'SEO analysis',
          endpoint: '/v1/analyze/seo',
          price: '$0.01',
        },
        {
          name: 'analyze_security',
          description: 'Security headers and TLS audit',
          endpoint: '/v1/analyze/security',
          price: '$0.01',
        },
        {
          name: 'analyze_business',
          description: 'Business signals extraction',
          endpoint: '/v1/analyze/business',
          price: '$0.01',
        },
        {
          name: 'analyze_ux',
          description: 'UX and accessibility audit',
          endpoint: '/v1/analyze/ux-accessibility',
          price: '$0.01',
        },
        {
          name: 'analyze_screenshots',
          description: 'Desktop and mobile screenshots',
          endpoint: '/v1/analyze/screenshots',
          price: '$0.01',
        },
      ],
    };
  }
}
