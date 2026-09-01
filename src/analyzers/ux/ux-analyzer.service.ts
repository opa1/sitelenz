import { Injectable } from '@nestjs/common';
import type { RawObservations } from '../../common/browser/raw-observations.interface';
import type { Analyzer, AnalyzerOptions } from '../analyzer.interface';

@Injectable()
export class UxAnalyzerService implements Analyzer {
  analyze(
    _observations: RawObservations,
    _options: AnalyzerOptions,
  ): Promise<Record<string, any>> {
    return Promise.resolve({});
  }
}
