export type AnalyzeEndpoint = 'technology' | 'seo' | 'security' | 'business';

export interface AnalyzeJobData {
  analyzeJobId: string;
  endpoint: AnalyzeEndpoint;
  url: string;
  normalizedUrl: string;
}
