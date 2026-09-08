import type { TechnologyResult } from '../analyzers/technology/technology-result.interface';
import type { SeoResult } from '../analyzers/seo/seo-result.interface';
import type { SecurityResult } from '../analyzers/security/security-result.interface';
import type { PerformanceResult } from '../analyzers/performance/performance-result.interface';
import type { BusinessResult } from '../analyzers/business/business-result.interface';
import type { UxResult } from '../analyzers/ux/ux-result.interface';
import type { AiResult } from '../ai/ai-provider.interface';
import type { ScreenshotEntry } from './screenshots/screenshots-result.interface';

/**
 * Shared result shape for the two composite endpoints (standard/full) - a
 * screenshot capture failure fails the whole job (unlike the standalone
 * screenshots endpoint, which tolerates a null per shot), so `desktop` is
 * always present here; `mobile` is only ever set by the full endpoint.
 */
export interface CompositeAnalyzeResult {
  analyzeJobId: string;
  url: string;
  endpoint: 'standard' | 'full';
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
  screenshots: {
    desktop: ScreenshotEntry;
    mobile?: ScreenshotEntry;
  };
  metadata: {
    completedAt: string;
    durationMs: number;
    cacheHit: boolean;
  };
}
