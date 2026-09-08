import type { AiResult } from '../../ai/ai-provider.interface';

/**
 * ai-summary's result is deliberately just the AI interpretation - it runs
 * the same crawl + all-six-analyzers pipeline as standard/full internally,
 * but only ever stores/returns the `ai` section, not the analyzer sections
 * themselves (that's what standard/full are for).
 */
export interface AiSummaryAnalyzeResult {
  url: string;
  ai: AiResult;
  metadata: {
    completedAt: string;
    durationMs: number;
    cacheHit: boolean;
  };
}
