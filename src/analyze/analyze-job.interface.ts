export type AnalyzeEndpoint =
  | 'technology'
  | 'seo'
  | 'security'
  | 'business'
  | 'performance'
  | 'ux-accessibility'
  | 'screenshots';

export interface AnalyzeJobData {
  analyzeJobId: string;
  endpoint: AnalyzeEndpoint;
  url: string;
  normalizedUrl: string;
}
