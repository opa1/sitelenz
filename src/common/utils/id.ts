import { ulid } from 'ulid';

export function generateAnalysisId(): string {
  return `sl_an_${ulid()}`;
}

export function generateCrawlObservationId(): string {
  return `sl_co_${ulid()}`;
}

export function generateAnalyzeJobId(): string {
  return `sl_aj_${ulid()}`;
}
