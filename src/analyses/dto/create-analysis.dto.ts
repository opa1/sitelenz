import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
} from 'class-validator';
import { AnalysisType } from '@prisma/client';

export class CreateAnalysisDto {
  @ApiProperty({
    description: 'The website URL to analyze',
    example: 'https://example.com',
  })
  @IsString()
  @IsNotEmpty()
  url: string;

  @ApiProperty({
    description: 'Analysis depth — determines the x402 price charged',
    enum: AnalysisType,
    example: AnalysisType.standard,
  })
  @IsEnum(AnalysisType)
  analysis: AnalysisType;

  @ApiPropertyOptional({
    description: 'HTTPS URL to notify when the analysis completes',
    example: 'https://myapp.com/webhooks/sitelenz',
  })
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  webhookUrl?: string;
}
