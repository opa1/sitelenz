export type LightweightFetchErrorCode =
  | 'SSRF_REDIRECT_LIMIT'
  | 'ANALYSIS_TIMEOUT'
  | 'WEBSITE_UNAVAILABLE';

/**
 * Carries a stable machine-readable `code` alongside the message, so a
 * catching processor can put it straight on the AnalyzeJob's error webhook
 * payload (see analysis.processor.ts's existing `err.code ?? 'UNKNOWN_ERROR'`
 * pattern, which this mirrors).
 */
export class LightweightFetchError extends Error {
  constructor(
    public readonly code: LightweightFetchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LightweightFetchError';
  }
}
