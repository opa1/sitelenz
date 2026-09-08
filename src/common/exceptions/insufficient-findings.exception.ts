import { BadRequestException } from '@nestjs/common';

/**
 * Thrown by POST /v1/analyze/ai-summary when `findings` has no keys at all.
 * Kept distinct from a generic BadRequestException so the global exception
 * filter can map it to the INSUFFICIENT_FINDINGS error code instead of
 * VALIDATION_ERROR.
 */
export class InsufficientFindingsException extends BadRequestException {
  constructor() {
    super('At least one findings key is required');
  }
}
