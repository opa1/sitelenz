import { Controller, Get, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { AppConfigService } from '../config';
import {
  ALGORAND_MAINNET_NETWORK,
  ALGORAND_TESTNET_NETWORK,
  ANALYZE_LIGHTWEIGHT_PRICE_USD,
  X402_GLOBAL_CHALLENGE_TAG,
} from '../x402/x402.constants';

interface X402DiscoveryResource {
  url: string;
  method: 'GET' | 'POST';
  description: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  extra: { tag: string };
}

interface X402DiscoveryDocument {
  x402Version: number;
  name: string;
  description: string;
  resources: X402DiscoveryResource[];
}

// USDC on Algorand has 6 decimal places - the facilitator's discovery schema
// wants `amount` in the asset's smallest unit (base units), same convention
// as the payment protocol itself, not a human-readable dollar figure.
const USDC_DECIMALS = 6;

// Description text is deliberately concrete about what the caller receives,
// not just the topic - matches how X402Guard's own bazaar extension example
// output looks, and gives an agent enough to decide whether the endpoint is
// worth paying for without a round trip.
const ANALYZE_ENDPOINTS: { name: string; description: string }[] = [
  {
    name: 'technology',
    description:
      'Detects frontend frameworks, CMS, CDN, analytics, payment providers, CSS libraries, and fonts from HTTP headers, DOM markers, and script analysis.',
  },
  {
    name: 'seo',
    description:
      'Inspects title, meta description, canonical, robots directives, Open Graph, Twitter cards, heading structure, image alt coverage, and structured data.',
  },
  {
    name: 'security',
    description:
      'Audits HTTP security headers (HSTS, CSP, X-Frame-Options, Referrer-Policy), HTTPS status, mixed content, and TLS certificate validity.',
  },
  {
    name: 'business',
    description:
      'Extracts business name, description, contact info, social links, pricing signals, CTA text, and business model indicators.',
  },
];

@SkipThrottle({ 'analysis-create': true })
@Controller('.well-known')
export class WellKnownController {
  constructor(private readonly appConfigService: AppConfigService) {}

  // Static discovery manifest for the GoPlausible x402 facilitator's Bazaar
  // (https://facilitator.goplausible.xyz/guide/discovery): unlike the
  // GET /v1/analyses probe route (which relies on a real payment being
  // settled to auto-catalog a resource), this file lets an agent see every
  // paid endpoint and its price up front, with no request required. Must be
  // a real 200 JSON response at this exact path - the facilitator's crawler
  // does not accept an SPA fallback.
  @Get('x402')
  x402(@Req() request: FastifyRequest): X402DiscoveryDocument {
    const network =
      this.appConfigService.network === 'mainnet'
        ? ALGORAND_MAINNET_NETWORK
        : ALGORAND_TESTNET_NETWORK;
    const networkConfig = this.appConfigService.activeNetworkConfig;
    // Same absolute-URL construction as X402Guard's resourceInfo.url - relies
    // on Fastify's trustProxy (main.ts) to report the real public host.
    const origin = `${request.protocol}://${request.host}`;
    const analysesUrl = `${origin}/v1/analyses`;

    const toAmount = (priceUsd: number): string =>
      String(Math.round(priceUsd * 10 ** USDC_DECIMALS));

    return {
      x402Version: 2,
      name: 'SiteLenz',
      description:
        'Website intelligence API - automated performance, SEO, and content analysis with a full report.',
      resources: [
        {
          url: analysesUrl,
          method: 'POST',
          description: `SiteLenz standard analysis - $${this.appConfigService.priceStandardUsd}. Body: {"url": "...", "analysis": "standard"}`,
          network,
          asset: networkConfig.usdcAssetId,
          amount: toAmount(this.appConfigService.priceStandardUsd),
          payTo: networkConfig.payToAddress,
          extra: { tag: X402_GLOBAL_CHALLENGE_TAG },
        },
        {
          url: analysesUrl,
          method: 'POST',
          description: `SiteLenz deep analysis - $${this.appConfigService.priceDeepUsd}. Body: {"url": "...", "analysis": "deep"}`,
          network,
          asset: networkConfig.usdcAssetId,
          amount: toAmount(this.appConfigService.priceDeepUsd),
          payTo: networkConfig.payToAddress,
          extra: { tag: X402_GLOBAL_CHALLENGE_TAG },
        },
        ...ANALYZE_ENDPOINTS.map(({ name, description }) => ({
          url: `${origin}/v1/analyze/${name}`,
          method: 'POST' as const,
          description: `${description} $${ANALYZE_LIGHTWEIGHT_PRICE_USD}. Body: {"url": "..."}`,
          network,
          asset: networkConfig.usdcAssetId,
          amount: toAmount(ANALYZE_LIGHTWEIGHT_PRICE_USD),
          payTo: networkConfig.payToAddress,
          extra: { tag: X402_GLOBAL_CHALLENGE_TAG },
        })),
      ],
    };
  }
}
