import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { x402ResourceServer, ResourceConfig } from '@x402/core/server';
import type { PaymentPayload } from '@x402/core/types';
import {
  decodePaymentSignatureHeader,
  encodePaymentResponseHeader,
} from '@x402/core/http';
import { AppConfigService } from '../config';
import { UrlValidatorService } from '../common/utils/url-validator.service';
import { InvalidUrlException } from '../common/exceptions/invalid-url.exception';
import { buildBazaarDiscoveryExtension } from './bazaar-discovery';
import { setValidatedNormalizedUrl } from './validated-url';
import {
  ALGORAND_MAINNET_NETWORK,
  ALGORAND_TESTNET_NETWORK,
  X402_GLOBAL_CHALLENGE_TAG,
  X402_MAX_TIMEOUT_SECONDS,
  X402_PAYMENT_HEADER,
  X402_RESOURCE_SERVER,
} from './x402.constants';
import { ANALYZE_ENDPOINT_KEY } from './analyze-price.decorator';
import { X402PaymentRequiredException } from './exceptions/x402-payment-required.exception';

/**
 * Guards every /v1/analyze/* endpoint. Each route declares its endpoint name
 * via @SetAnalyzePrice, which this guard reads to resolve the per-endpoint
 * price. A request with no payment header - including bodyless crawler / x402
 * Doctor probes - receives the 402 challenge first, before any application-
 * level validation. A request that carries a payment then has its URL validated
 * (protocol + DNS + SSRF) before settlement, so an invalid or unsafe URL is
 * rejected with 400 and never charged.
 */
@Injectable()
export class X402Guard implements CanActivate {
  constructor(
    @Inject(X402_RESOURCE_SERVER)
    private readonly resourceServer: x402ResourceServer,
    private readonly appConfigService: AppConfigService,
    private readonly reflector: Reflector,
    private readonly urlValidator: UrlValidatorService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();

    const analyzeEndpoint = this.reflector.getAllAndOverride<
      string | undefined
    >(ANALYZE_ENDPOINT_KEY, [context.getHandler(), context.getClass()]);
    if (!analyzeEndpoint) {
      throw new InternalServerErrorException(
        'X402Guard applied to a route with no @SetAnalyzePrice endpoint',
      );
    }
    const priceUsd = this.appConfigService.analyzePrices[analyzeEndpoint];
    if (priceUsd === undefined) {
      throw new InternalServerErrorException(
        `No configured price for analyze endpoint "${analyzeEndpoint}"`,
      );
    }

    const network =
      this.appConfigService.network === 'mainnet'
        ? ALGORAND_MAINNET_NETWORK
        : ALGORAND_TESTNET_NETWORK;
    const networkConfig = this.appConfigService.activeNetworkConfig;

    const resourceConfig: ResourceConfig = {
      scheme: 'exact',
      payTo: networkConfig.payToAddress,
      network,
      price: `$${priceUsd}`,
      maxTimeoutSeconds: X402_MAX_TIMEOUT_SECONDS,
      // `x402-global-challenge` is the Algorand Global x402 Challenge's
      // leaderboard tag. See the research note in x402.module.ts - the
      // facilitator reads this from `extra.tag` on the built payment
      // requirement (confirmed against a live, already-tagged resource in
      // its own discovery catalog).
      extra: {
        asset: networkConfig.usdcAssetId,
        tag: X402_GLOBAL_CHALLENGE_TAG,
      },
    };

    const requirements =
      await this.resourceServer.buildPaymentRequirements(resourceConfig);
    const resourceInfo = {
      // Absolute, not just the path - every resource observed in the
      // facilitator's live discovery catalog is cataloged under a full
      // https://host/path URL. Relies on Fastify's trustProxy (main.ts) to
      // report the real public protocol/host when behind a load balancer.
      // `request.host` (not `.hostname`) - hostname alone drops the port,
      // which broke locally on any non-default port.
      url: `${request.protocol}://${request.host}${request.url}`,
      description: `SiteLenz ${analyzeEndpoint} analysis`,
      mimeType: 'application/json',
    };

    // Bazaar catalog listing: per the facilitator's integration guide
    // (facilitator.goplausible.xyz/guide), a settled payment only gets
    // auto-cataloged into /discovery/resources if the 402 response that
    // preceded it carried a valid `bazaar` extension describing the resource's
    // input/output shape - without a valid one "payments process but the
    // endpoint remains unlisted". Built via the official @x402/extensions
    // helper (see buildBazaarDiscoveryExtension) so it passes the facilitator's
    // own discovery validator; attached on every method since the Doctor /
    // Bazaar crawler only probes with GET.
    const bazaarExtension = buildBazaarDiscoveryExtension(analyzeEndpoint);

    // Merchant identity (optional, per the same guide): controls the name,
    // logo, and categories shown on the facilitator's merchant listing. If
    // omitted entirely, the facilitator falls back to crawling the domain
    // root for OpenGraph tags/llms.txt/agent-card.json - SiteLenz is a pure
    // API with no root HTML page, so that fallback would find nothing.
    // `logo` points at the static file served from public/ (see main.ts).
    const origin = `${request.protocol}://${request.host}`;
    const merchantExtension = {
      'x402-merchant': {
        info: {
          name: 'SiteLenz',
          website: origin,
          logo: `${origin}/logo.png`,
          categories: ['api', 'algorand', 'x402', 'website-analysis'],
        },
        schema: {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'object',
          properties: {
            name: { type: 'string' },
            website: { type: 'string', format: 'uri' },
            logo: { type: 'string', format: 'uri' },
            categories: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    };

    const extensions = { ...bazaarExtension, ...merchantExtension };

    const rawHeader = request.headers[X402_PAYMENT_HEADER];
    const paymentHeader = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

    if (!paymentHeader) {
      throw new X402PaymentRequiredException(
        await this.resourceServer.createPaymentRequiredResponse(
          requirements,
          resourceInfo,
          'Payment required',
          extensions,
        ),
      );
    }

    // Any request without a payment header - including bodyless probes from
    // the x402 Doctor / Bazaar crawler - has already received the 402 challenge
    // above, before any application-level validation runs. Only a request that
    // actually carries a payment reaches here, and its URL is validated now
    // (protocol allowlist + DNS + SSRF/private-IP rejection) BEFORE
    // verify/settle below - so a malformed or unsafe URL is rejected with 400
    // and the caller is never charged. Fastify has already parsed the body by
    // the time a guard runs, so request.body is available.
    if (request.method === 'POST') {
      const body = request.body as { url?: unknown } | null | undefined;
      const url = typeof body?.url === 'string' ? body.url : '';
      const validation = await this.urlValidator.validate(url);
      if (!validation.valid) {
        throw new InvalidUrlException(validation.reason);
      }
      setValidatedNormalizedUrl(request, validation.normalizedUrl);
    }

    let paymentPayload: PaymentPayload;
    try {
      paymentPayload = decodePaymentSignatureHeader(paymentHeader);
    } catch {
      throw new X402PaymentRequiredException(
        await this.resourceServer.createPaymentRequiredResponse(
          requirements,
          resourceInfo,
          'Invalid payment signature',
          extensions,
        ),
      );
    }

    const matched = this.resourceServer.findMatchingRequirements(
      requirements,
      paymentPayload,
    );
    if (!matched) {
      throw new X402PaymentRequiredException(
        await this.resourceServer.createPaymentRequiredResponse(
          requirements,
          resourceInfo,
          'No matching payment requirements',
          extensions,
        ),
      );
    }

    const verifyResult = await this.resourceServer.verifyPayment(
      paymentPayload,
      matched,
    );
    if (!verifyResult.isValid) {
      throw new X402PaymentRequiredException(
        await this.resourceServer.createPaymentRequiredResponse(
          requirements,
          resourceInfo,
          verifyResult.invalidReason ?? 'Payment verification failed',
          extensions,
        ),
      );
    }

    const settleResult = await this.resourceServer.settlePayment(
      paymentPayload,
      matched,
    );
    if (!settleResult.success) {
      throw new X402PaymentRequiredException(
        await this.resourceServer.createPaymentRequiredResponse(
          requirements,
          resourceInfo,
          settleResult.errorReason ?? 'Payment settlement failed',
          extensions,
        ),
      );
    }

    // Echo the settlement receipt back on the successful response so payers
    // (and the Doctor's CORS check, which expects this header to exist and
    // be exposed) can read it without a second facilitator/chain lookup.
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    reply.header('PAYMENT-RESPONSE', encodePaymentResponseHeader(settleResult));

    return true;
  }
}
