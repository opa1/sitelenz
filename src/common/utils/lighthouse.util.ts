import type { LighthouseResult } from '../browser/raw-observations.interface';

export interface LighthouseAudit {
  score: number | null;
  numericValue?: number;
  displayValue?: string;
}

export function getLighthouseCategoryScore(
  lhr: LighthouseResult | null,
  category: string,
): number | null {
  if (!lhr) return null;
  try {
    const categories = lhr.categories as
      Record<string, { score?: number | null }> | undefined;
    const score = categories?.[category]?.score;
    return typeof score === 'number' ? Math.round(score * 100) : null;
  } catch {
    return null;
  }
}

export function getLighthouseAudit(
  lhr: LighthouseResult | null,
  auditId: string,
): LighthouseAudit | null {
  if (!lhr) return null;
  try {
    const audits = lhr.audits as Record<string, LighthouseAudit> | undefined;
    const audit = audits?.[auditId];
    if (!audit) return null;
    return audit;
  } catch {
    return null;
  }
}
