import type { RawObservations } from '../common/browser/raw-observations.interface';

export interface AnalyzerOptions {
  deep: boolean;
}

export interface Analyzer {
  analyze(
    observations: RawObservations,
    options: AnalyzerOptions,
  ): Promise<Record<string, any>>;
}
