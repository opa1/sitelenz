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
   * ai-summary only - the client-supplied analyzer findings it should
   * interpret. Persisted on AnalyzeJob.findings (not just carried on the
   * BullMQ job payload) so a retry, which reads the job back from Postgres,
   * has it too.
   */
  findings?: Record<string, unknown>;
}
