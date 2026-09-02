import type { AnalysisType } from '@prisma/client';
import type { TechnologyResult } from '../../analyzers/technology/technology-result.interface';
import type { SeoResult } from '../../analyzers/seo/seo-result.interface';
import type { SecurityResult } from '../../analyzers/security/security-result.interface';
import type { PerformanceResult } from '../../analyzers/performance/performance-result.interface';
import type { BusinessResult } from '../../analyzers/business/business-result.interface';
import type { UxResult } from '../../analyzers/ux/ux-result.interface';
import type { AiResult } from '../../ai/ai-provider.interface';

export interface ScreenshotResult {
  type: 'desktop' | 'mobile';
  url: string;
  blockerDismissed: boolean;
}

export interface AnalysisReport {
  analysisId: string;
  url: string;
  analysisType: AnalysisType;
  website: {
    finalUrl: string;
    statusCode: number;
    redirectChain: string[];
  };
  technology: TechnologyResult;
  seo: SeoResult;
  security: SecurityResult;
  performance: PerformanceResult;
  business: BusinessResult;
  ux: UxResult;
  ai: AiResult;
  screenshots: ScreenshotResult[];
  metadata: {
    analysisCompletedAt: string;
    analysisDurationMs: number;
  };
}
