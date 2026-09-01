import {
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Observable } from 'rxjs';
import { UrlValidatorService } from '../../common/utils/url-validator.service';
import { InvalidUrlException } from '../../common/exceptions/invalid-url.exception';
import { X402Guard } from '../../x402/x402.guard';

/**
 * Runs SSRF/URL validation before X402Guard's payment logic, so an invalid
 * URL is rejected with 400 INVALID_URL before the caller is ever charged.
 *
 * NestJS always runs guards before interceptors and pipes, so a pipe or a
 * plain interceptor cannot itself execute ahead of a guard attached via
 * @UseGuards(). Instead, X402Guard is no longer attached via @UseGuards() on
 * this route — it is left completely unmodified and its canActivate() is
 * invoked here, manually, only after URL validation has already passed.
 */
@Injectable()
export class UrlValidationInterceptor implements NestInterceptor {
  constructor(
    private readonly urlValidator: UrlValidatorService,
    private readonly x402Guard: X402Guard,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const body = request.body as Record<string, unknown> | undefined;
    const url = body?.['url'];

    if (typeof url !== 'string' || url.length === 0) {
      // A missing/non-string url would otherwise fail CreateAnalysisDto's
      // @IsNotEmpty() validation later in the pipe stage — but that stage
      // runs after the guard, so a missing url must be rejected here too,
      // not just a malformed one, to keep it from ever reaching payment.
      throw new InvalidUrlException('URL is required');
    }

    const validation = await this.urlValidator.validate(url);
    if (!validation.valid) {
      throw new InvalidUrlException(validation.reason);
    }

    const allowed = await this.x402Guard.canActivate(context);
    if (!allowed) {
      throw new ForbiddenException();
    }

    return next.handle();
  }
}
