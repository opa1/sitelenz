import { All, Controller, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

@ApiTags('analyses')
@Controller('v1/analyses')
export class AnalysesController {
  @All(['/', '*'])
  @HttpCode(301)
  @ApiOperation({
    summary: 'Moved permanently',
    description: '/v1/analyses/* has moved permanently to /v1/analyze/*',
    deprecated: true,
  })
  @ApiResponse({
    status: 301,
    description: 'This API has permanently moved to /v1/analyze/*',
    schema: {
      example: {
        statusCode: 301,
        message: 'This API has permanently moved to /v1/analyze/*',
        documentation: '/docs',
      },
    },
  })
  redirect() {
    return {
      statusCode: 301,
      message: 'This API has permanently moved to /v1/analyze/*',
      documentation: '/docs',
    };
  }
}
