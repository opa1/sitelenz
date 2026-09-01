import type { AnalysisInput } from './ai-input.interface';

export const AI_PROVIDER = Symbol('AI_PROVIDER');

export type RecommendationPriority = 'high' | 'medium' | 'low';

export type RecommendationCategory =
  'security' | 'seo' | 'performance' | 'ux' | 'business' | 'technical';

export interface AiRecommendation {
  priority: RecommendationPriority;
  category: RecommendationCategory;
  finding: string;
}

export interface AiResult {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  notableFindings: string[];
  technicalInterpretation: string;
  businessInterpretation: string;
  recommendations: AiRecommendation[];
  modelUsed: string;
  interpretedAt: string;
}

export interface AIProvider {
  interpret(
    input: AnalysisInput,
    options: { deep: boolean },
  ): Promise<AiResult>;
}
