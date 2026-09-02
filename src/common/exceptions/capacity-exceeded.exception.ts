import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Thrown when the number of currently-running analyses has reached
 * MAX_CONCURRENT_ANALYSES. Distinct from the IP-based rate limit (which
 * caps request frequency) — this caps how much work the pipeline is
 * allowed to have in flight at once, regardless of who's asking.
 */
export class CapacityExceededException extends HttpException {
  constructor(
    message = 'Analysis capacity is currently full. Please retry shortly.',
  ) {
    super(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}
