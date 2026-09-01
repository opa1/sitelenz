import { HttpException, HttpStatus } from '@nestjs/common';
import type { PaymentRequired } from '@x402/core/types';

/**
 * Carries the raw x402 PaymentRequired body verbatim so x402 clients can parse
 * it. The global exception filter special-cases this type and must not wrap it
 * in the generic { error: { code, message } } envelope used for app errors.
 */
export class X402PaymentRequiredException extends HttpException {
  constructor(paymentRequired: PaymentRequired) {
    super(paymentRequired, HttpStatus.PAYMENT_REQUIRED);
  }
}
