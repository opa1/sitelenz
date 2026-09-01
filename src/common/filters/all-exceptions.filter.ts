import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { X402PaymentRequiredException } from '../../x402/exceptions/x402-payment-required.exception';
import { InvalidUrlException } from '../exceptions/invalid-url.exception';

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();

    // x402 PaymentRequired carries its own protocol shape — never wrap it.
    if (exception instanceof X402PaymentRequiredException) {
      void reply
        .status(HttpStatus.PAYMENT_REQUIRED)
        .send(exception.getResponse());
      return;
    }

    if (exception instanceof NotFoundException) {
      void reply
        .status(HttpStatus.NOT_FOUND)
        .send(this.body('NOT_FOUND', this.messageOf(exception)));
      return;
    }

    // Check before the generic BadRequestException branch: this subclasses it.
    if (exception instanceof InvalidUrlException) {
      void reply
        .status(HttpStatus.BAD_REQUEST)
        .send(this.body('INVALID_URL', exception.message));
      return;
    }

    if (exception instanceof BadRequestException) {
      const response = exception.getResponse();
      if (
        typeof response === 'object' &&
        response !== null &&
        'details' in response
      ) {
        const { message, details } = response as {
          message?: string;
          details?: unknown;
        };
        void reply
          .status(HttpStatus.BAD_REQUEST)
          .send(
            this.body(
              'VALIDATION_ERROR',
              message ?? 'Validation failed',
              details,
            ),
          );
        return;
      }
      void reply
        .status(HttpStatus.BAD_REQUEST)
        .send(this.body('VALIDATION_ERROR', this.messageOf(exception)));
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      void reply
        .status(status)
        .send(this.body(this.codeForStatus(status), this.messageOf(exception)));
      return;
    }

    this.logger.error(exception instanceof Error ? exception.stack : exception);
    void reply
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .send(this.body('INTERNAL_ERROR', 'An unexpected error occurred'));
  }

  private body(code: string, message: string, details?: unknown): ErrorBody {
    return details === undefined
      ? { error: { code, message } }
      : { error: { code, message, details } };
  }

  private messageOf(exception: HttpException): string {
    const response = exception.getResponse();
    if (typeof response === 'string') return response;
    if (
      typeof response === 'object' &&
      response !== null &&
      'message' in response
    ) {
      const message = (response as { message?: string | string[] }).message;
      return Array.isArray(message)
        ? message.join(', ')
        : (message ?? exception.message);
    }
    return exception.message;
  }

  private codeForStatus(status: number): string {
    if (status === 400) return 'BAD_REQUEST';
    if (status === 401) return 'UNAUTHORIZED';
    if (status === 403) return 'FORBIDDEN';
    if (status === 404) return 'NOT_FOUND';
    return 'ERROR';
  }
}
