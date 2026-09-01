import type { AnalysisType } from '@prisma/client';

export interface AnalysisJobData {
  analysisId: string;
  url: string;
  analysisType: AnalysisType;
  webhookUrl?: string | null;
}
