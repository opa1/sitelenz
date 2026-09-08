import { ApiProperty } from '@nestjs/swagger';

export type PendingAnalyzeJobStatus = 'queued' | 'running' | 'failed';

export class AnalyzeResultPendingResponseDto {
  @ApiProperty({ example: 'sl_aj_01j8z9k3n8v5w6x7y8z9a0b1c2' })
  analyzeJobId: string;

  @ApiProperty({
    enum: ['queued', 'running', 'failed'],
    example: 'running',
    description:
      'Current status. Never "completed" for this response shape - a completed job returns the result body directly instead.',
  })
  status: PendingAnalyzeJobStatus;

  @ApiProperty({ example: 'Analysis not yet complete' })
  message: string;
}
