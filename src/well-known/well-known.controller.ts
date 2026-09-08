import { Controller, Get, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { AppConfigService } from '../config';
import { ANALYZE_ENDPOINT_CATALOG } from '../analyze/analyze-endpoint-catalog';
import {
  ALGORAND_MAINNET_NETWORK,
  ALGORAND_TESTNET_NETWORK,
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

// The client body shape differs only for ai-summary (findings, not just a
// url to crawl) - everything else takes {"url": "..."}.
function bodyHintFor(name: string): string {
  return name === 'ai-summary'
    ? '{"url": "...", "findings": {"seo": {...}, "security": {...}}}'
    : '{"url": "..."}';
}

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
        ...ANALYZE_ENDPOINT_CATALOG.map(({ name, description, price }) => ({
          url: `${origin}/v1/analyze/${name}`,
          method: 'POST' as const,
          description: `${description} $${price}. Body: ${bodyHintFor(name)}`,
          network,
          asset: networkConfig.usdcAssetId,
          amount: toAmount(price),
          payTo: networkConfig.payToAddress,
          extra: { tag: X402_GLOBAL_CHALLENGE_TAG },
        })),
      ],
    };
  }
}
