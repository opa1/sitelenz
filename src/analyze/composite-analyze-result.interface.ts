import type { TechnologyResult } from '../analyzers/technology/technology-result.interface';
import type { SeoResult } from '../analyzers/seo/seo-result.interface';
import type { SecurityResult } from '../analyzers/security/security-result.interface';
import type { PerformanceResult } from '../analyzers/performance/performance-result.interface';
import type { BusinessResult } from '../analyzers/business/business-result.interface';
import type { UxResult } from '../analyzers/ux/ux-result.interface';
import type { AiResult } from '../ai/ai-provider.interface';
import type { ScreenshotEntry } from './screenshots/screenshots-result.interface';

/**
 * Shared result shape for the two composite endpoints (standard/full).
 * Screenshot capture is fault-tolerant here too (matching the standalone
 * screenshots endpoint) - a screenshot timing out or otherwise failing
 * shouldn't discard an already-completed crawl and all six analyzers, so
 * `desktop`/`mobile` are nullable rather than required. `mobile` is only
 * ever populated by the full endpoint (absent entirely for standard).
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
    desktop: ScreenshotEntry | null;
    mobile?: ScreenshotEntry | null;
  };
  metadata: {
    completedAt: string;
    durationMs: number;
    cacheHit: boolean;
  };
}
