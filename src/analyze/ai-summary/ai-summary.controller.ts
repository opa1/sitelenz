import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { ANALYZE_AI_SUMMARY_PRICE_USD } from '../../x402/x402.constants';
import { BaseAnalyzeController } from '../base-analyze.controller';
import { AnalyzeJobCreatedResponseDto } from '../dto/analyze-job-created-response.dto';
import { AnalyzeJobStatusResponseDto } from '../dto/analyze-job-status-response.dto';
import { AnalyzeResultPendingResponseDto } from '../dto/analyze-result-pending-response.dto';
import { RetryAnalyzeJobResponseDto } from '../dto/retry-analyze-job-response.dto';
import { CreateAiSummaryJobDto } from './create-ai-summary-job.dto';

const ENDPOINT = 'ai-summary' as const;

@SkipThrottle({ 'analysis-create': true })
@ApiTags('analyze')
@Controller('v1/analyze/ai-summary')
export class AiSummaryController {
  constructor(private readonly baseAnalyzeController: BaseAnalyzeController) {}

  @Post()
  @SkipThrottle({ 'analysis-create': false })
  @Throttle({ 'analysis-create': { limit: 10, ttl: 60_000 } })
  @SetAnalyzePrice(ANALYZE_AI_SUMMARY_PRICE_USD)
  @UseGuards(X402Guard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Interpret pre-analyzed findings with AI',
    description:
      'Queues an AI-interpretation job over client-supplied analyzer findings - no crawl happens, so this never touches a URL. Returns an executive summary, strengths, weaknesses, notable findings, and prioritized recommendations. Requires an x402 payment of $0.05, enforced via the PAYMENT-SIGNATURE header.',
  })
  @ApiBody({ type: CreateAiSummaryJobDto })
  @ApiResponse({
    status: 200,
    description: 'Analyze job queued',
    type: AnalyzeJobCreatedResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Request body failed validation, or findings had no keys at all',
    schema: {
      example: {
        error: {
          code: 'INSUFFICIENT_FINDINGS',
          message: 'At least one findings key is required',
        },
      },
    },
  })
  @ApiResponse({
    status: 402,
    description: 'Payment required - $0.05, raw x402 PaymentRequired body',
    schema: {
      example: {
        x402Version: 2,
        error: 'Payment required',
        resource: {
          url: '/v1/analyze/ai-summary',
          description: 'SiteLenz ai-summary analysis',
          mimeType: 'application/json',
        },
        accepts: [
          {
            scheme: 'exact',
            network: 'algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe',
            asset: '10458941',
            amount: '50000',
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
    description: 'Rate limited (10/min per IP on this endpoint, or 200/min globally)',
    schema: {
      example: {
        error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' },
      },
    },
  })
  async create(
    @Body() dto: CreateAiSummaryJobDto,
    @Req() req: FastifyRequest,
  ): Promise<AnalyzeJobCreatedResponseDto> {
    return this.baseAnalyzeController.createJob({
      url: dto.url,
      webhookUrl: dto.webhookUrl,
      endpoint: ENDPOINT,
      price: ANALYZE_AI_SUMMARY_PRICE_USD,
      findings: dto.findings,
      req,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get ai-summary analyze job status and progress' })
  @ApiParam({ name: 'id', example: 'sl_aj_01j8z9k3n8v5w6x7y8z9a0b1c2' })
  @ApiResponse({ status: 200, description: 'Job found', type: AnalyzeJobStatusResponseDto })
  @ApiResponse({
    status: 404,
    description: 'No analyze job exists with this id',
    schema: {
      example: { error: { code: 'NOT_FOUND', message: 'Analyze job "sl_aj_xxx" not found' } },
    },
  })
  async getJob(@Param('id') id: string): Promise<AnalyzeJobStatusResponseDto> {
    return this.baseAnalyzeController.getJob(id);
  }

  @Get(':id/result')
  @ApiOperation({
    summary: 'Get the ai-summary result',
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
      example: { error: { code: 'NOT_FOUND', message: 'Analyze job "sl_aj_xxx" not found' } },
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
    summary: 'Retry a failed ai-summary analyze job',
    description:
      'Re-queues a previously failed job with the same findings. No x402 payment is required. Only jobs currently in the "failed" state can be retried.',
  })
  @ApiParam({ name: 'id', example: 'sl_aj_01j8z9k3n8v5w6x7y8z9a0b1c2' })
  @ApiResponse({ status: 200, description: 'Job reset and re-queued', type: RetryAnalyzeJobResponseDto })
  @ApiResponse({
    status: 400,
    description: 'The job is not currently in the "failed" state',
    schema: {
      example: {
        error: { code: 'ANALYSIS_NOT_FAILED', message: 'Only failed analyses can be retried' },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'No analyze job exists with this id',
    schema: {
      example: { error: { code: 'NOT_FOUND', message: 'Analyze job "sl_aj_xxx" not found' } },
    },
  })
  async retry(@Param('id') id: string): Promise<RetryAnalyzeJobResponseDto> {
    return this.baseAnalyzeController.retryJob(id);
  }
}
