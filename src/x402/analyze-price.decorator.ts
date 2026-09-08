import { SetMetadata } from '@nestjs/common';

export const ANALYZE_PRICE_KEY = 'x402:analyzePrice';

/**
 * Declares a fixed USD price for a route, read by X402Guard ahead of its
 * default analysisType-based (`standard`/`deep`) pricing lookup. Used by the
 * /v1/analyze/* endpoints, whose request body has no `analysis` field for
 * that lookup to key off.
 */
export const SetAnalyzePrice = (usd: number) => SetMetadata(ANALYZE_PRICE_KEY, usd);
