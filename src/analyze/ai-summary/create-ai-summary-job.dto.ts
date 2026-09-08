import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsUrl } from 'class-validator';

export class CreateAiSummaryJobDto {
  @ApiProperty({
    description:
      'Freeform analyzer findings to interpret - any subset of technology/seo/security/performance/business/ux outputs. At least one key is required.',
    example: {
      seo: { title: { present: true, length: 42 } },
      security: { securityScore: 65, https: { enabled: true } },
    },
  })
  @IsObject()
  findings: Record<string, any>;

  @ApiProperty({
    description:
      'The website these findings are about - not crawled, purely descriptive metadata (structurally validated, no SSRF/DNS check since nothing is fetched)',
    example: 'https://example.com',
  })
  @IsUrl({ require_protocol: true })
  url: string;

  @ApiPropertyOptional({
    description: 'HTTPS URL to notify when the job completes',
    example: 'https://myapp.com/webhooks/sitelenz',
  })
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  webhookUrl?: string;
}
