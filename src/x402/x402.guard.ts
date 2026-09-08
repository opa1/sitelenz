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
 * Every route this guard protects is one of the /v1/analyze/* endpoints and
 * declares its endpoint name via @SetAnalyzePrice - the legacy /v1/analyses
 * body-shape ("analysis": "standard"/"deep") pricing path this guard used
 * to also support was removed once that controller became a plain 301
 * redirect with no guard attached at all.
 */
@Injectable()
export class X402Guard implements CanActivate {
  constructor(
    @Inject(X402_RESOURCE_SERVER)
    private readonly resourceServer: x402ResourceServer,
    private readonly appConfigService: AppConfigService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();

    const analyzeEndpoint = this.reflector.getAllAndOverride<string | undefined>(
      ANALYZE_ENDPOINT_KEY,
      [context.getHandler(), context.getClass()],
    );
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
    // preceded it carried a `bazaar` extension describing the resource's
    // input/output shape - without it "payments process but the endpoint
    // remains unlisted". We call x402ResourceServer directly (not the
    // higher-level paymentMiddleware helper that builds this from a
    // RouteConfig), so it's built by hand here and passed through the one
    // low-level hook that exists for it: createPaymentRequiredResponse's
    // `extensions` parameter.
    //
    // Attached on every method, not just POST: the x402 Doctor (and the
    // Bazaar's own discovery crawler) only ever probes with GET - an earlier
    // version of this guard scoped the extension to POST only "since GET is
    // just a decoy," which meant the Doctor's GET probe never saw it and
    // reported "no bazaar extension in the 402" even though real POST
    // settles were happening (confirmed via a live Doctor report against
    // api.sitelenz.online). The extension describes the real paid action
    // (POST's body/response shape) regardless of which method fetched the
    // challenge. Every /v1/analyze/* route shares the same generic
    // {url, webhookUrl?} -> {analyzeJobId, status, endpoint, createdAt}
    // shape (ai-summary's extra `findings` field is documented on its own
    // route in Swagger, not here).
    const bazaarExtension = {
      bazaar: {
        info: {
          input: {
            type: 'http',
            method: 'POST',
            bodyType: 'json',
            body: { url: 'https://example.com' },
          },
          output: {
            type: 'json',
            example: {
              analyzeJobId: 'sl_aj_01j8z9k3n8v5w6x7y8z9a0b1c2',
              status: 'queued',
              endpoint: analyzeEndpoint,
              createdAt: '2026-09-08T12:00:00.000Z',
            },
          },
        },
        // A single JSON Schema document with one root-level `$schema`, not
        // separate `input`/`output` sub-documents each with their own -
        // the catalog validator checks `bazaar.schema.$schema` specifically
        // and silently drops the resource from /discovery/resources if it's
        // missing there (confirmed via a live x402 Doctor report against
        // api.sitelenz.online: "Present but REJECTED by the catalog
        // validator... bazaar.schema.$schema must be draft 2020-12").
        schema: {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: 'object',
          required: ['input'],
          properties: {
            input: {
              type: 'object',
              required: ['url'],
              properties: {
                url: {
                  type: 'string',
                  format: 'uri',
                  description: 'The website URL to analyze',
                },
                webhookUrl: {
                  type: 'string',
                  format: 'uri',
                  description: 'HTTPS URL to notify when the job completes',
                },
              },
            },
            output: {
              type: 'object',
              properties: {
                analyzeJobId: { type: 'string' },
                status: {
                  type: 'string',
                  enum: ['queued', 'running', 'completed', 'failed'],
                },
                endpoint: { type: 'string' },
                createdAt: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
      },
    };

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
