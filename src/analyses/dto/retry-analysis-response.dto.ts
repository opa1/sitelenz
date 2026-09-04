import { ApiProperty } from '@nestjs/swagger';
import { AnalysisStatus, AnalysisType } from '@prisma/client';

export class RetryAnalysisResponseDto {
  @ApiProperty({ example: 'sl_an_01j8z9k3n8v5w6x7y8z9a0b1c2' })
  analysisId: string;

  @ApiProperty({ enum: AnalysisStatus, example: AnalysisStatus.queued })
  status: AnalysisStatus;

  @ApiProperty({ enum: AnalysisType, example: AnalysisType.standard })
  analysis: AnalysisType;

  @ApiProperty({ example: true })
  retried: boolean;
}
