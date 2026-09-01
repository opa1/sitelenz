import { Injectable, Logger } from '@nestjs/common';
import Groq from 'groq-sdk';
import { AppConfigService } from '../config';
import type { AnalysisInput } from './ai-input.interface';
import type {
  AIProvider,
  AiRecommendation,
  AiResult,
  RecommendationCategory,
  RecommendationPriority,
} from './ai-provider.interface';

const MAX_TOKENS_STANDARD = 2000;
const MAX_TOKENS_DEEP = 4000;
const SIMPLIFIED_MAX_TOKENS = 300;
const FALLBACK_MODEL_NAME = 'fallback';

const SYSTEM_PROMPT =
  'You are a website intelligence analyst. You receive structured, ' +
  'programmatically-detected findings about a website and produce concise, ' +
  'accurate interpretations. You do not speculate beyond what the data ' +
  'supports. You do not fabricate metrics. When data is absent or marked ' +
  'unknown, you acknowledge the gap rather than inventing a value. Your ' +
  'output must be valid JSON matching the schema provided.';

const RESULT_SCHEMA_COMMENT = `// AiResult JSON schema — return an object matching exactly this shape:
{
  "summary": string,                 // 2-4 sentence executive summary
  "strengths": string[],             // 3-5 concrete positive observations
  "weaknesses": string[],            // 3-5 concrete issues or gaps
  "notableFindings": string[],       // interesting signals worth highlighting
  "technicalInterpretation": string, // 2-3 sentences on technical stack/infra
  "businessInterpretation": string,  // 2-3 sentences on business model/maturity
  "recommendations": [               // 3-8 items
    {
      "priority": "high" | "medium" | "low",
      "category": "security" | "seo" | "performance" | "ux" | "business" | "technical",
      "finding": string
    }
  ]
}`;

const PRIORITIES: RecommendationPriority[] = ['high', 'medium', 'low'];
const CATEGORIES: RecommendationCategory[] = [
  'security',
  'seo',
  'performance',
  'ux',
  'business',
  'technical',
];

@Injectable()
export class GroqProvider implements AIProvider {
  private readonly logger = new Logger(GroqProvider.name);
  private readonly client: Groq;

  constructor(private readonly appConfigService: AppConfigService) {
    this.client = new Groq({ apiKey: this.appConfigService.groqApiKey });
  }

  async interpret(
    input: AnalysisInput,
    options: { deep: boolean },
  ): Promise<AiResult> {
    try {
      const maxTokens = options.deep ? MAX_TOKENS_DEEP : MAX_TOKENS_STANDARD;
      const content = await this.request(
        SYSTEM_PROMPT,
        this.buildUserPrompt(input),
        maxTokens,
      );
      const parsed = content ? this.parseResult(content) : null;
      if (parsed) return parsed;
    } catch (error) {
      this.logger.warn(
        `Groq interpretation request failed: ${(error as Error).message}`,
      );
    }

    try {
      const content = await this.request(
        SYSTEM_PROMPT,
        this.buildSimplifiedPrompt(input),
        SIMPLIFIED_MAX_TOKENS,
      );
      const summary = content ? this.parseSimplifiedSummary(content) : null;
      if (summary) return this.buildSummaryOnlyResult(summary);
    } catch (error) {
      this.logger.warn(
        `Groq simplified retry failed: ${(error as Error).message}`,
      );
    }

    return this.fallbackResult();
  }

  private async request(
    systemPrompt: string,
    userPrompt: string,
    maxTokens: number,
  ): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.appConfigService.groqModel,
      temperature: 0.3,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });
    return response.choices[0]?.message?.content ?? '';
  }

  private buildUserPrompt(input: AnalysisInput): string {
    return [
      `Analysis type: ${input.analysisType}`,
      '',
      'Structured findings, already detected programmatically — interpret them, do not re-derive or contradict them:',
      JSON.stringify(input),
      '',
      'Return only valid JSON with no markdown, no backticks, and no preamble, matching exactly this schema:',
      RESULT_SCHEMA_COMMENT,
    ].join('\n');
  }

  private buildSimplifiedPrompt(input: AnalysisInput): string {
    return [
      `Analysis type: ${input.analysisType}`,
      '',
      'Structured findings, already detected programmatically:',
      JSON.stringify(input),
      '',
      'Return only valid JSON with no markdown, no backticks, and no preamble, in exactly this shape:',
      '{ "summary": string }',
      'The summary must be 2-4 sentences interpreting the findings above.',
    ].join('\n');
  }

  /** Models occasionally wrap JSON in markdown fences despite instructions. */
  private extractJson(content: string): string | null {
    const trimmed = content.trim();
    const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
    const candidate = fenced ? fenced[1].trim() : trimmed;
    if (candidate.startsWith('{') && candidate.endsWith('}')) {
      return candidate;
    }
    const match = /\{[\s\S]*\}/.exec(candidate);
    return match ? match[0] : null;
  }

  private parseResult(content: string): AiResult | null {
    const jsonText = this.extractJson(content);
    if (!jsonText) return null;

    let parsed: Partial<AiResult>;
    try {
      parsed = JSON.parse(jsonText) as Partial<AiResult>;
    } catch {
      return null;
    }

    if (!this.isValidResult(parsed)) return null;

    return {
      summary: parsed.summary,
      strengths: parsed.strengths,
      weaknesses: parsed.weaknesses,
      notableFindings: parsed.notableFindings,
      technicalInterpretation: parsed.technicalInterpretation,
      businessInterpretation: parsed.businessInterpretation,
      recommendations: parsed.recommendations,
      modelUsed: this.appConfigService.groqModel,
      interpretedAt: new Date().toISOString(),
    };
  }

  private isValidResult(
    parsed: Partial<AiResult>,
  ): parsed is Required<
    Pick<
      AiResult,
      | 'summary'
      | 'strengths'
      | 'weaknesses'
      | 'notableFindings'
      | 'technicalInterpretation'
      | 'businessInterpretation'
      | 'recommendations'
    >
  > {
    return (
      typeof parsed.summary === 'string' &&
      parsed.summary.trim().length > 0 &&
      Array.isArray(parsed.strengths) &&
      parsed.strengths.every((s) => typeof s === 'string') &&
      Array.isArray(parsed.weaknesses) &&
      parsed.weaknesses.every((s) => typeof s === 'string') &&
      Array.isArray(parsed.notableFindings) &&
      parsed.notableFindings.every((s) => typeof s === 'string') &&
      typeof parsed.technicalInterpretation === 'string' &&
      typeof parsed.businessInterpretation === 'string' &&
      Array.isArray(parsed.recommendations) &&
      parsed.recommendations.every((r) => this.isValidRecommendation(r))
    );
  }

  private isValidRecommendation(value: unknown): value is AiRecommendation {
    if (!value || typeof value !== 'object') return false;
    const r = value as Partial<AiRecommendation>;
    return (
      typeof r.priority === 'string' &&
      PRIORITIES.includes(r.priority) &&
      typeof r.category === 'string' &&
      CATEGORIES.includes(r.category) &&
      typeof r.finding === 'string' &&
      r.finding.trim().length > 0
    );
  }

  private parseSimplifiedSummary(content: string): string | null {
    const jsonText = this.extractJson(content);
    if (!jsonText) return null;
    try {
      const parsed = JSON.parse(jsonText) as { summary?: unknown };
      return typeof parsed.summary === 'string' && parsed.summary.trim()
        ? parsed.summary
        : null;
    } catch {
      return null;
    }
  }

  private buildSummaryOnlyResult(summary: string): AiResult {
    return {
      summary,
      strengths: [],
      weaknesses: [],
      notableFindings: [],
      technicalInterpretation: '',
      businessInterpretation: '',
      recommendations: [],
      modelUsed: this.appConfigService.groqModel,
      interpretedAt: new Date().toISOString(),
    };
  }

  private fallbackResult(): AiResult {
    return {
      summary: 'AI interpretation unavailable',
      strengths: [],
      weaknesses: [],
      notableFindings: [],
      technicalInterpretation: '',
      businessInterpretation: '',
      recommendations: [],
      modelUsed: FALLBACK_MODEL_NAME,
      interpretedAt: new Date().toISOString(),
    };
  }
}
