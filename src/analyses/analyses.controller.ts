import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { UrlValidationInterceptor } from './interceptors/url-validation.interceptor';
import { AnalysesService } from './analyses.service';
import { CreateAnalysisDto } from './dto/create-analysis.dto';
import { CreateAnalysisResponseDto } from './dto/create-analysis-response.dto';
import { AnalysisStatusResponseDto } from './dto/analysis-status-response.dto';

@ApiTags('analyses')
@Controller('v1/analyses')
export class AnalysesController {
  constructor(private readonly analysesService: AnalysesService) {}

  @Post()
  @UseInterceptors(UrlValidationInterceptor)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Create a website analysis',
    description:
      'Queues a new analysis job. The URL is validated (SSRF-checked) before payment is enforced, so an invalid URL never charges the caller. Requires an x402 payment: $1 for a standard analysis, $2 for a deep analysis, enforced via the PAYMENT-SIGNATURE header. If a completed analysis for the same URL and type exists within the cache TTL, returns it immediately instead of queuing a new job.',
  })
  @ApiBody({ type: CreateAnalysisDto })
  @ApiResponse({
    status: 200,
    description: 'Analysis queued (or a cached result was returned)',
    type: CreateAnalysisResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Request body failed validation, or the URL is invalid/unsafe',
    schema: {
      example: {
        error: { code: 'INVALID_URL', message: 'Malformed URL' },
      },
    },
  })
  @ApiResponse({
    status: 402,
    description: 'Payment required — raw x402 PaymentRequired body',
    schema: {
      example: {
        x402Version: 2,
        error: 'Payment required',
        resource: {
          url: '/v1/analyses',
          description: 'SiteLenz standard analysis',
          mimeType: 'application/json',
        },
        accepts: [
          {
            scheme: 'exact',
            network: 'algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe',
            asset: '10458941',
            amount: '1000000',
            payTo: 'RECEIVER_ALGORAND_ADDRESS',
            maxTimeoutSeconds: 60,
            extra: {},
          },
        ],
      },
    },
  })
  async create(
    @Body() dto: CreateAnalysisDto,
  ): Promise<CreateAnalysisResponseDto> {
    return this.analysesService.createAnalysis(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get analysis status and progress' })
  @ApiParam({ name: 'id', example: 'sl_an_01j8z9k3n8v5w6x7y8z9a0b1c2' })
  @ApiResponse({
    status: 200,
    description: 'Analysis found',
    type: AnalysisStatusResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'No analysis exists with this id',
    schema: {
      example: {
        error: { code: 'NOT_FOUND', message: 'Analysis "sl_an_xxx" not found' },
      },
    },
  })
  async getStatus(@Param('id') id: string): Promise<AnalysisStatusResponseDto> {
    return this.analysesService.getAnalysisStatus(id);
  }
}
