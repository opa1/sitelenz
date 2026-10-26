export type AnalyzeEndpoint =
  | 'technology'
  | 'seo'
  | 'security'
  | 'business'
  | 'performance'
  | 'ux-accessibility'
  | 'screenshots'
  | 'ai-summary'
  | 'standard'
  | 'full';

export interface AnalyzeJobData {
  analyzeJobId: string;
  endpoint: AnalyzeEndpoint;
  url: string;
  normalizedUrl: string;
  /**
   * Epoch ms of the first time this job found no free heavy-analyze slot and
   * was delayed back into the queue. Set once, so MAX_CAPACITY_WAIT_MS is
   * measured across every re-delay. Absent for jobs that never had to wait
   * (and for retries, which are re-added with fresh data).
   */
  capacityWaitStartedAt?: number;
}
