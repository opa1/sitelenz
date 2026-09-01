import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AnalysisStatus, AnalysisType } from '@prisma/client';

export class CreateAnalysisResponseDto {
  @ApiProperty({ example: 'sl_an_01j8z9k3n8v5w6x7y8z9a0b1c2' })
  analysisId: string;

  @ApiProperty({ enum: AnalysisStatus, example: AnalysisStatus.queued })
  status: AnalysisStatus;

  @ApiProperty({ enum: AnalysisType, example: AnalysisType.standard })
  analysis: AnalysisType;

  @ApiProperty({ example: '2026-08-30T12:00:00.000Z' })
  createdAt: string;

  @ApiPropertyOptional({
    description:
      'True when this analysisId is a cached result from a prior completed analysis of the same URL and type, rather than a newly queued job',
    example: true,
  })
  cached?: boolean;
}
