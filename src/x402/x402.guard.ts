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
    const priceUsd = this.resolvePrice(analysisType);

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
      extra: { asset: networkConfig.usdcAssetId },
    };

    const requirements =
      await this.resourceServer.buildPaymentRequirements(resourceConfig);
    const resourceInfo = {
      url: request.url,
      description: `SiteLenz ${String(analysisType)} analysis`,
      mimeType: 'application/json',
    };

    const rawHeader = request.headers[X402_PAYMENT_HEADER];
    const paymentHeader = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

    if (!paymentHeader) {
      throw new X402PaymentRequiredException(
        await this.resourceServer.createPaymentRequiredResponse(
          requirements,
          resourceInfo,
          'Payment required',
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
