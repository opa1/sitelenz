import { BadRequestException } from '@nestjs/common';

/**
 * Thrown for structurally invalid or SSRF-unsafe URLs (see UrlValidatorService).
 * Kept distinct from a generic BadRequestException so the global exception
 * filter can map it to the INVALID_URL error code instead of VALIDATION_ERROR.
 */
export class InvalidUrlException extends BadRequestException {
  constructor(reason: string) {
    super(reason);
  }
}
