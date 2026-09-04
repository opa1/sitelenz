import { BadRequestException } from '@nestjs/common';

/**
 * Thrown by the retry endpoint when the target analysis isn't in the
 * 'failed' state. Kept distinct from a generic BadRequestException so the
 * global exception filter can map it to the ANALYSIS_NOT_FAILED error code
 * instead of VALIDATION_ERROR.
 */
export class AnalysisNotFailedException extends BadRequestException {
  constructor() {
    super('Only failed analyses can be retried');
  }
}
