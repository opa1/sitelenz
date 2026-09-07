import { ApiProperty } from '@nestjs/swagger';

export type PendingAnalysisStatus = 'queued' | 'running' | 'failed' | 'expired';

export class AnalysisReportPendingResponseDto {
  @ApiProperty({ example: 'sl_an_01j8z9k3n8v5w6x7y8z9a0b1c2' })
  analysisId: string;

  @ApiProperty({
    enum: ['queued', 'running', 'failed', 'expired'],
    example: 'running',
    description:
      'Current status. Never "completed" for this response shape - a completed analysis returns the report body directly instead.',
  })
  status: PendingAnalysisStatus;

  @ApiProperty({ example: 'Analysis is not yet complete' })
  message: string;
}
