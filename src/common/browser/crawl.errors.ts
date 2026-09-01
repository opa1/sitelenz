export class SsrfDetectedError extends Error {
  readonly code = 'SSRF_DETECTED';
  constructor(reason: string) {
    super(`SSRF blocked: ${reason}`);
  }
}

export class AnalysisTimeoutError extends Error {
  readonly code = 'ANALYSIS_TIMEOUT';
  constructor(message = 'Analysis timed out') {
    super(message);
  }
}

export class WebsiteUnavailableError extends Error {
  readonly code = 'WEBSITE_UNAVAILABLE';
  constructor(message: string) {
    super(message);
  }
}
