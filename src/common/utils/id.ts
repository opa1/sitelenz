import { ulid } from 'ulid';

export function generateAnalysisId(): string {
  return `sl_an_${ulid()}`;
}
