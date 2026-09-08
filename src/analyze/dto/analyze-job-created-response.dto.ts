import { ApiProperty } from '@nestjs/swagger';
import { AnalyzeJobStatus } from '@prisma/client';

export class AnalyzeJobCreatedResponseDto {
  @ApiProperty({ example: 'sl_aj_01j8z9k3n8v5w6x7y8z9a0b1c2' })
  analyzeJobId: string;

  @ApiProperty({ enum: AnalyzeJobStatus, example: AnalyzeJobStatus.queued })
  status: AnalyzeJobStatus;

  @ApiProperty({ example: 'technology' })
  endpoint: string;

  @ApiProperty({ example: '2026-09-08T12:00:00.000Z' })
  createdAt: string;
}
