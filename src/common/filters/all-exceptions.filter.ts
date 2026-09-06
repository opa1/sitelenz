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
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ThrottlerException } from '@nestjs/throttler';
import { X402PaymentRequiredException } from '../../x402/exceptions/x402-payment-required.exception';
import { InvalidUrlException } from '../exceptions/invalid-url.exception';
import { CapacityExceededException } from '../exceptions/capacity-exceeded.exception';
import { AnalysisNotFailedException } from '../exceptions/analysis-not-failed.exception';

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const request = host.switchToHttp().getRequest<FastifyRequest>();

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

    // Exact required message, not the library's own "ThrottlerException:
    // Too Many Requests" — checked before the generic HttpException branch.
    if (exception instanceof ThrottlerException) {
      void reply
        .status(HttpStatus.TOO_MANY_REQUESTS)
        .send(
          this.body('RATE_LIMITED', 'Too many requests. Please slow down.'),
        );
      return;
    }

    // Same 429 status as ThrottlerException but a distinct code — this is
    // capacity admission control, not a per-IP request-frequency limit.
    if (exception instanceof CapacityExceededException) {
      void reply
        .status(HttpStatus.TOO_MANY_REQUESTS)
        .send(this.body('CAPACITY_EXCEEDED', exception.message));
      return;
    }

    // Check before the generic BadRequestException branch: this subclasses it.
    if (exception instanceof InvalidUrlException) {
      void reply
        .status(HttpStatus.BAD_REQUEST)
        .send(this.body('INVALID_URL', exception.message));
      return;
    }

    // Also subclasses BadRequestException — check before the generic branch.
    if (exception instanceof AnalysisNotFailedException) {
      void reply
        .status(HttpStatus.BAD_REQUEST)
        .send(this.body('ANALYSIS_NOT_FAILED', exception.message));
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
      const status: HttpStatus = exception.getStatus();
      if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
        this.logUnhandled(exception, request);
      }
      void reply
        .status(status)
        .send(this.body(this.codeForStatus(status), this.messageOf(exception)));
      return;
    }

    this.logUnhandled(exception, request);
    void reply
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .send(this.body('INTERNAL_ERROR', 'An unexpected error occurred'));
  }

  // Every exception that reaches the client as a 500 goes through here —
  // this is why 500s used to show no detail in the logs at all: a thrown
  // InternalServerErrorException took the generic HttpException branch
  // above, which never logged anything.
  private logUnhandled(exception: unknown, request: FastifyRequest): void {
    this.logger.error('Unhandled exception', {
      path: request.url,
      method: request.method,
      error: exception instanceof Error ? exception.message : String(exception),
      stack: exception instanceof Error ? exception.stack : undefined,
    });
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
