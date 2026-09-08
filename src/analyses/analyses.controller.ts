import { All, Controller, HttpCode } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

// Permanently moved to /v1/analyze/* - excluded from Swagger entirely
// (rather than documented+deprecated) since the migration is complete and
// there's nothing here worth a caller reading about.
@ApiExcludeController()
@Controller('v1/analyses')
export class AnalysesController {
  @All(['/', '*'])
  @HttpCode(301)
  redirect() {
    return {
      statusCode: 301,
      message: 'This API has permanently moved to /v1/analyze/*',
      documentation: '/docs',
    };
  }
}
