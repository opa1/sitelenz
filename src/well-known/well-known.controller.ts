import { Controller, Get, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';
import { AppConfigService } from '../config';
import { withAnalyzePrices } from '../analyze/analyze-endpoint-catalog';
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
  // (https://facilitator.goplausible.xyz/guide/discovery): lets an agent see
  // every paid endpoint and its price up front, with no request required.
  // Must be a real 200 JSON response at this exact path - the facilitator's
  // crawler does not accept an SPA fallback.
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

    const toAmount = (priceUsd: number): string =>
      String(Math.round(priceUsd * 10 ** USDC_DECIMALS));

    return {
      x402Version: 2,
      name: 'SiteLenz',
      description:
        'Website intelligence API - automated technology, SEO, security, performance, business, and UX analysis, individually or as a full report, with AI interpretation.',
      resources: withAnalyzePrices(this.appConfigService).map(
        ({ name, description, price }) => ({
          url: `${origin}/v1/analyze/${name}`,
          method: 'POST' as const,
          description: `${description} $${price}. Body: ${bodyHintFor(name)}`,
          network,
          asset: networkConfig.usdcAssetId,
          amount: toAmount(price),
          payTo: networkConfig.payToAddress,
          extra: { tag: X402_GLOBAL_CHALLENGE_TAG },
        }),
      ),
    };
  }
}
