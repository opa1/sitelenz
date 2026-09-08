import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUrl } from 'class-validator';

export class CreateAnalyzeJobDto {
  @ApiProperty({
    description: 'The website URL to analyze',
    example: 'https://example.com',
  })
  @IsString()
  @IsNotEmpty()
  url: string;

  @ApiPropertyOptional({
    description: 'HTTPS URL to notify when the job completes',
    example: 'https://myapp.com/webhooks/sitelenz',
  })
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  webhookUrl?: string;
}
