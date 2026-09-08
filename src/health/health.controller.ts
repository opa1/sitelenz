import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { AppConfigService } from '../config';
import { ANALYZE_ENDPOINT_CATALOG } from '../analyze/analyze-endpoint-catalog';

// The 10/min 'analysis-create' tier is scoped to POST /v1/analyze/* only
// (see e.g. technology.controller.ts) - skip it here so health checks are
// subject solely to the 'global' 200/min tier.
@SkipThrottle({ 'analysis-create': true })
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly appConfigService: AppConfigService) {}

  @Get()
  @ApiOperation({ summary: 'Health check' })
  @ApiResponse({
    status: 200,
    description: 'Service is up',
    schema: {
      example: {
        status: 'ok',
        network: 'testnet',
        version: '1.0.0',
        timestamp: '2026-09-02T12:00:00.000Z',
        architecture: 'v2',
        endpoints: 10,
      },
    },
  })
  check() {
    return {
      status: 'ok',
      network: this.appConfigService.network,
      version: this.appConfigService.version,
      timestamp: new Date().toISOString(),
      architecture: 'v2',
      endpoints: ANALYZE_ENDPOINT_CATALOG.length,
    };
  }
}
