import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AnalyzeJobStatus } from '@prisma/client';

export class AnalyzeJobStatusResponseDto {
  @ApiProperty({ example: 'sl_aj_01j8z9k3n8v5w6x7y8z9a0b1c2' })
  analyzeJobId: string;

  @ApiProperty({ example: 'technology' })
  endpoint: string;

  @ApiProperty({ enum: AnalyzeJobStatus, example: AnalyzeJobStatus.running })
  status: AnalyzeJobStatus;

  @ApiProperty({ example: 'analyzing' })
  progressStage: string;

  @ApiProperty({ example: '2026-09-08T12:00:00.000Z' })
  createdAt: string;

  @ApiProperty({ example: null, nullable: true, type: String })
  completedAt: string | null;

  @ApiPropertyOptional({
    description:
      'Present only when status is "failed" - the error that ended the job',
    example: 'Unable to reach https://example.com: getaddrinfo ENOTFOUND',
  })
  errorMessage?: string;
}
