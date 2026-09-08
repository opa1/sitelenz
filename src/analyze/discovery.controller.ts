import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { AppConfigService } from '../config';
import { withAnalyzePrices } from './analyze-endpoint-catalog';

interface AnalyzeEndpointSummary {
  path: string;
  method: 'POST';
  price: string;
  description: string;
  async: true;
  resultPath: string;
}

interface AnalyzeCatalogDocument {
  endpoints: AnalyzeEndpointSummary[];
}

// No payment required - this is a plain catalog, not an analysis. Lets an
// agent discover every /v1/analyze/* endpoint, its price, and how to fetch
// its result without reading Swagger first.
@SkipThrottle({ 'analysis-create': true })
@ApiTags('analyze')
@Controller('v1/analyze')
export class DiscoveryController {
  constructor(private readonly appConfigService: AppConfigService) {}

  @Get()
  @ApiOperation({
    summary: 'Catalog every /v1/analyze/* endpoint',
    description:
      'Returns every analyze endpoint, its current price, and its result path. No x402 payment required.',
  })
  @ApiResponse({
    status: 200,
    description: 'Endpoint catalog',
    schema: {
      example: {
        endpoints: [
          {
            path: '/v1/analyze/technology',
            method: 'POST',
            price: '$0.01',
            description:
              'Detects frontend frameworks, CMS, CDN, analytics, payment providers, CSS libraries, and fonts from HTTP headers, DOM markers, and script analysis.',
            async: true,
            resultPath: '/v1/analyze/technology/:id/result',
          },
        ],
      },
    },
  })
  list(): AnalyzeCatalogDocument {
    return {
      endpoints: withAnalyzePrices(this.appConfigService).map(
        ({ name, description, price }) => ({
          path: `/v1/analyze/${name}`,
          method: 'POST',
          price: `$${price}`,
          description,
          async: true,
          resultPath: `/v1/analyze/${name}/:id/result`,
        }),
      ),
    };
  }
}
