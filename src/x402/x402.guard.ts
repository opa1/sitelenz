import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AnalysisType } from '@prisma/client';
import type { x402ResourceServer, ResourceConfig } from '@x402/core/server';
import type { PaymentPayload } from '@x402/core/types';
import { decodePaymentSignatureHeader } from '@x402/core/http';
import { AppConfigService } from '../config';
import {
  ALGORAND_MAINNET_NETWORK,
  ALGORAND_TESTNET_NETWORK,
  X402_GLOBAL_CHALLENGE_TAG,
  X402_MAX_TIMEOUT_SECONDS,
  X402_PAYMENT_HEADER,
  X402_RESOURCE_SERVER,
} from './x402.constants';
import { X402PaymentRequiredException } from './exceptions/x402-payment-required.exception';

@Injectable()
export class X402Guard implements CanActivate {
  constructor(
    @Inject(X402_RESOURCE_SERVER)
    private readonly resourceServer: x402ResourceServer,
    private readonly appConfigService: AppConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();

    const body = request.body as Record<string, unknown> | undefined;
    const analysisType = body?.['analysis'];
    // Discovery probes (x402 Bazaar's doctor) hit this route with a plain,
    // bodyless GET just to see the 402 challenge — there's no "analysis"
    // field to resolve a price from, so resolvePrice's strict validation
    // (correct for POST's real body) doesn't apply here. Any real payment
    // still fails matching below since resourceConfig.price won't match
    // what the caller signed for a non-existent GET-priced resource.
    const priceUsd =
      request.method === 'GET'
        ? this.appConfigService.priceStandardUsd
        : this.resolvePrice(analysisType);

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
      // leaderboard tag. See the research note in x402.module.ts — the
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
      // Absolute, not just the path — every resource observed in the
      // facilitator's live discovery catalog is cataloged under a full
      // https://host/path URL. Relies on Fastify's trustProxy (main.ts) to
      // report the real public protocol/host when behind a load balancer.
      // `request.host` (not `.hostname`) — hostname alone drops the port,
      // which broke locally on any non-default port.
      url: `${request.protocol}://${request.host}${request.url}`,
      description:
        request.method === 'GET'
          ? 'SiteLenz website analysis'
          : `SiteLenz ${String(analysisType)} analysis`,
      mimeType: 'application/json',
    };

    // Bazaar catalog listing: per the facilitator's integration guide
    // (facilitator.goplausible.xyz/guide), a settled payment only gets
    // auto-cataloged into /discovery/resources if the 402 response that
    // preceded it carried a `bazaar` extension describing the resource's
    // input/output shape — without it "payments process but the endpoint
    // remains unlisted". We call x402ResourceServer directly (not the
    // higher-level paymentMiddleware helper that builds this from a
    // RouteConfig), so it's built by hand here and passed through the one
    // low-level hook that exists for it: createPaymentRequiredResponse's
    // `extensions` parameter. Only attached for the real POST resource — the
    // GET route above is a discovery-probe decoy with no body/response of
    // its own and must never itself get cataloged as a payable resource.
    const bazaarExtension =
      request.method === 'GET'
        ? undefined
        : {
            bazaar: {
              info: {
                input: {
                  type: 'http',
                  method: 'POST',
                  bodyType: 'json',
                  body: { url: 'https://example.com', analysis: 'standard' },
                },
                output: {
                  type: 'json',
                  example: {
                    analysisId: 'sl_an_01j8z9k3n8v5w6x7y8z9a0b1c2',
                    status: 'queued',
                    analysis: 'standard',
                    createdAt: '2026-08-30T12:00:00.000Z',
                  },
                },
              },
              schema: {
                input: {
                  $schema: 'https://json-schema.org/draft/2020-12/schema',
                  type: 'object',
                  required: ['url', 'analysis'],
                  properties: {
                    url: {
                      type: 'string',
                      format: 'uri',
                      description: 'The website URL to analyze',
                    },
                    analysis: {
                      type: 'string',
                      enum: ['standard', 'deep'],
                      description:
                        'Analysis depth — determines the price charged',
                    },
                    webhookUrl: {
                      type: 'string',
                      format: 'uri',
                      description:
                        'HTTPS URL to notify when the analysis completes',
                    },
                  },
                },
                output: {
                  $schema: 'https://json-schema.org/draft/2020-12/schema',
                  type: 'object',
                  properties: {
                    analysisId: { type: 'string' },
                    status: {
                      type: 'string',
                      enum: [
                        'queued',
                        'running',
                        'completed',
                        'failed',
                        'expired',
                      ],
                    },
                    analysis: { type: 'string', enum: ['standard', 'deep'] },
                    createdAt: { type: 'string', format: 'date-time' },
                    cached: { type: 'boolean' },
                  },
                },
              },
            },
          };

    const rawHeader = request.headers[X402_PAYMENT_HEADER];
    const paymentHeader = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

    if (!paymentHeader) {
      throw new X402PaymentRequiredException(
        await this.resourceServer.createPaymentRequiredResponse(
          requirements,
          resourceInfo,
          'Payment required',
          bazaarExtension,
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
          bazaarExtension,
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
          bazaarExtension,
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
          bazaarExtension,
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
          bazaarExtension,
        ),
      );
    }

    return true;
  }

  private resolvePrice(analysisType: unknown): number {
    if (analysisType === AnalysisType.standard) {
      return this.appConfigService.priceStandardUsd;
    }
    if (analysisType === AnalysisType.deep) {
      return this.appConfigService.priceDeepUsd;
    }
    throw new BadRequestException(
      'Request body "analysis" field must be "standard" or "deep"',
    );
  }
}
