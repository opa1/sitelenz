import { Injectable, Logger } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Paths that never get logged, to keep health-check polling out of the logs.
const EXCLUDED_PATHS = new Set(['/health']);

// Under the Fastify adapter, Nest's `use()` is backed by an internal
// middie-style shim operating on the raw Node req/res, not a Fastify
// request/reply. That shim rewrites `req.url` to be relative to the
// middleware's mount point (standard connect/Express behavior) while
// preserving the true full request path on `req.originalUrl` — which isn't
// part of Node's IncomingMessage type, hence this extension.
interface MiddlewareRequest extends IncomingMessage {
  originalUrl?: string;
}

@Injectable()
export class HttpLoggerMiddleware implements NestMiddleware<
  MiddlewareRequest,
  ServerResponse
> {
  private readonly logger = new Logger('HTTP');

  use(
    req: MiddlewareRequest,
    res: ServerResponse,
    next: (error?: unknown) => void,
  ): void {
    const startedAt = process.hrtime.bigint();
    const url = req.originalUrl ?? req.url ?? '';
    const path = url.split('?')[0];

    // Logged on completion (via `res.on('finish')`, not `reply.addHook`,
    // which needs a Fastify reply instance this layer doesn't have) so the
    // status code and duration are both known.
    res.on('finish', () => {
      if (EXCLUDED_PATHS.has(path)) {
        return;
      }
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      this.logger.log(
        `${req.method} ${url} ${res.statusCode} ${Math.round(durationMs)}ms`,
      );
    });

    next();
  }
}
