import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { X402Guard } from '../../x402/x402.guard';
import { SetAnalyzePrice } from '../../x402/analyze-price.decorator';
import { BaseAnalyzeController } from '../base-analyze.controller';
import { CreateAnalyzeJobDto } from '../dto/create-analyze-job.dto';
import { AnalyzeJobCreatedResponseDto } from '../dto/analyze-job-created-response.dto';
import { AnalyzeJobStatusResponseDto } from '../dto/analyze-job-status-response.dto';
import { AnalyzeResultPendingResponseDto } from '../dto/analyze-result-pending-response.dto';
import { RetryAnalyzeJobResponseDto } from '../dto/retry-analyze-job-response.dto';

const ENDPOINT = 'seo' as const;

@SkipThrottle({ 'analysis-create': true })
@ApiTags('analyze')
@Controller('v1/analyze/seo')
export class SeoController {
  constructor(private readonly baseAnalyzeController: BaseAnalyzeController) {}

  @Post()
  @SkipThrottle({ 'analysis-create': false })
  @Throttle({ 'analysis-create': { limit: 10, ttl: 60_000 } })
  @SetAnalyzePrice(ENDPOINT)
  @UseGuards(X402Guard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Analyze a website's on-page SEO",
    description:
      'Queues a lightweight SEO-analysis job (plain HTTP fetch, no browser). Inspects title, meta description, canonical, robots directives, Open Graph, Twitter cards, heading structure, image alt coverage, and structured data. Requires an x402 payment of $0.01, enforced via the PAYMENT-SIGNATURE header.',
  })
  @ApiBody({ type: CreateAnalyzeJobDto })
  @ApiResponse({
    status: 200,
    description: 'Analyze job queued',
    type: AnalyzeJobCreatedResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Request body failed validation, or the URL is invalid/unsafe',
    schema: {
      example: { error: { code: 'INVALID_URL', message: 'Malformed URL' } },
    },
  })
  @ApiResponse({
    status: 402,
    description: 'Payment required - $0.01, raw x402 PaymentRequired body',
    schema: {
      example: {
        x402Version: 2,
        error: 'Payment required',
        resource: {
          url: '/v1/analyze/seo',
          description: 'SiteLenz seo analysis',
          mimeType: 'application/json',
        },
        accepts: [
          {
            scheme: 'exact',
            network: 'algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe',
            asset: '10458941',
            amount: '10000',
            payTo: 'RECEIVER_ALGORAND_ADDRESS',
            maxTimeoutSeconds: 60,
            extra: {},
          },
        ],
      },
    },
  })
  @ApiResponse({
    status: 429,
    description:
      'Rate limited (10/min per IP on this endpoint, or 200/min globally)',
    schema: {
      example: {
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please slow down.',
        },
      },
    },
  })
  async create(
    @Body() dto: CreateAnalyzeJobDto,
    @Req() req: FastifyRequest,
  ): Promise<AnalyzeJobCreatedResponseDto> {
    return this.baseAnalyzeController.createJob({
      url: dto.url,
      webhookUrl: dto.webhookUrl,
      endpoint: ENDPOINT,
      req,
    });
  }

  // The x402 Doctor (and the Bazaar discovery crawler) probes with a plain
  // GET to see the 402 challenge before ever sending a real payment - same
  // fix as the old /v1/analyses discovery route. The guard fires and throws
  // 402 before this body ever runs.
  @Get()
  @SetAnalyzePrice(ENDPOINT)
  @UseGuards(X402Guard)
  discover(): never {
    throw new NotFoundException();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get seo analyze job status and progress' })
  @ApiParam({ name: 'id', example: 'sl_aj_01j8z9k3n8v5w6x7y8z9a0b1c2' })
  @ApiResponse({
    status: 200,
    description: 'Job found',
    type: AnalyzeJobStatusResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'No analyze job exists with this id',
    schema: {
      example: {
        error: {
          code: 'NOT_FOUND',
          message: 'Analyze job "sl_aj_xxx" not found',
        },
      },
    },
  })
  async getJob(@Param('id') id: string): Promise<AnalyzeJobStatusResponseDto> {
    return this.baseAnalyzeController.getJob(id);
  }

  @Get(':id/result')
  @ApiOperation({
    summary: 'Get the seo analysis result',
    description:
      'Returns the stored result once the job has completed. No x402 payment is required here - the job was already paid for when it was created.',
  })
  @ApiParam({ name: 'id', example: 'sl_aj_01j8z9k3n8v5w6x7y8z9a0b1c2' })
  @ApiResponse({
    status: 200,
    description: 'Job completed - full stored result JSON',
    schema: { type: 'object' },
  })
  @ApiResponse({
    status: 202,
    description: 'Job has not completed yet (or it failed)',
    type: AnalyzeResultPendingResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'No analyze job exists with this id',
    schema: {
      example: {
        error: {
          code: 'NOT_FOUND',
          message: 'Analyze job "sl_aj_xxx" not found',
        },
      },
    },
  })
  async getResult(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<AnalyzeResultPendingResponseDto | Record<string, unknown>> {
    const outcome = await this.baseAnalyzeController.getResult(id);
    if (outcome.ready) {
      return outcome.result;
    }
    res.status(HttpStatus.ACCEPTED);
    return outcome.pending;
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Retry a failed seo analyze job',
    description:
      'Re-queues a previously failed job for the same URL. No x402 payment is required. Only jobs currently in the "failed" state can be retried.',
  })
  @ApiParam({ name: 'id', example: 'sl_aj_01j8z9k3n8v5w6x7y8z9a0b1c2' })
  @ApiResponse({
    status: 200,
    description: 'Job reset and re-queued',
    type: RetryAnalyzeJobResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'The job is not currently in the "failed" state',
    schema: {
      example: {
        error: {
          code: 'ANALYSIS_NOT_FAILED',
          message: 'Only failed analyses can be retried',
        },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'No analyze job exists with this id',
    schema: {
      example: {
        error: {
          code: 'NOT_FOUND',
          message: 'Analyze job "sl_aj_xxx" not found',
        },
      },
    },
  })
  async retry(@Param('id') id: string): Promise<RetryAnalyzeJobResponseDto> {
    return this.baseAnalyzeController.retryJob(id);
  }
}
