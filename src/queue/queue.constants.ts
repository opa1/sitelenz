export const ANALYSIS_QUEUE = 'analysis';
export const ANALYSIS_JOB_NAME = 'process-analysis';

export const WEBHOOK_QUEUE = 'webhook';
export const WEBHOOK_JOB_NAME = 'deliver-webhook';

export const ANALYZE_WEBHOOK_QUEUE = 'analyze-webhook';
export const ANALYZE_WEBHOOK_JOB_NAME = 'deliver-analyze-webhook';

// One BullMQ queue per lightweight analyze endpoint, not a single shared
// 'analyze' queue - a BullMQ queue is a work queue, not pub/sub: any Worker
// bound to it can atomically claim the next job, and there's no built-in way
// to route by job name across multiple Worker instances on the same queue.
// A single 'analyze' queue with four different @Processor classes listening
// on it would let e.g. a "technology" job get silently claimed and processed
// by the "seo" worker instead.
export const ANALYZE_TECHNOLOGY_QUEUE = 'analyze-technology';
export const ANALYZE_TECHNOLOGY_JOB_NAME = 'process-analyze-technology';

export const ANALYZE_SEO_QUEUE = 'analyze-seo';
export const ANALYZE_SEO_JOB_NAME = 'process-analyze-seo';

export const ANALYZE_SECURITY_QUEUE = 'analyze-security';
export const ANALYZE_SECURITY_JOB_NAME = 'process-analyze-security';

export const ANALYZE_BUSINESS_QUEUE = 'analyze-business';
export const ANALYZE_BUSINESS_JOB_NAME = 'process-analyze-business';

// Same one-queue-per-endpoint reasoning as above, for the three Playwright-
// backed ("heavy") endpoints.
export const ANALYZE_PERFORMANCE_QUEUE = 'analyze-performance';
export const ANALYZE_PERFORMANCE_JOB_NAME = 'process-analyze-performance';

export const ANALYZE_UX_ACCESSIBILITY_QUEUE = 'analyze-ux-accessibility';
export const ANALYZE_UX_ACCESSIBILITY_JOB_NAME =
  'process-analyze-ux-accessibility';

export const ANALYZE_SCREENSHOTS_QUEUE = 'analyze-screenshots';
export const ANALYZE_SCREENSHOTS_JOB_NAME = 'process-analyze-screenshots';

// Composite endpoints - same one-queue-per-endpoint reasoning as above.
export const ANALYZE_AI_SUMMARY_QUEUE = 'analyze-ai-summary';
export const ANALYZE_AI_SUMMARY_JOB_NAME = 'process-analyze-ai-summary';

export const ANALYZE_STANDARD_QUEUE = 'analyze-standard';
export const ANALYZE_STANDARD_JOB_NAME = 'process-analyze-standard';

export const ANALYZE_FULL_QUEUE = 'analyze-full';
export const ANALYZE_FULL_JOB_NAME = 'process-analyze-full';
