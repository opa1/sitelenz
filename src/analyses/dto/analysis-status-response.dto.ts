import { ApiProperty } from '@nestjs/swagger';
import { AnalysisStatus, AnalysisType } from '@prisma/client';

export class AnalysisStatusResponseDto {
  @ApiProperty({ example: 'sl_an_01j8z9k3n8v5w6x7y8z9a0b1c2' })
  analysisId: string;

  @ApiProperty({ enum: AnalysisStatus, example: AnalysisStatus.running })
  status: AnalysisStatus;

  @ApiProperty({ enum: AnalysisType, example: AnalysisType.standard })
  analysis: AnalysisType;

  @ApiProperty({ example: 'crawling' })
  progress: string;

  @ApiProperty({ example: '2026-08-30T12:00:00.000Z' })
  createdAt: string;

  @ApiProperty({
    example: null,
    nullable: true,
    type: String,
  })
  completedAt: string | null;
}
