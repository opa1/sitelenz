import { join } from 'node:path';
import type { ValidationError } from '@nestjs/common';
import { BadRequestException, Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

const processLogger = new Logger('Process');

// This is a long-running worker process, not a request/response script - a
// third-party library throwing from an async callback outside any promise
// chain we control (observed from Lighthouse's internal CDP session
// handling) must not take the whole server down along with every other
// in-flight analysis. Log and keep running rather than let Node's default
// behavior (crash) apply.
process.on('uncaughtException', (error) => {
  processLogger.error(`Uncaught exception: ${error.message}`, error.stack);
});
process.on('unhandledRejection', (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  processLogger.error(`Unhandled rejection: ${error.message}`, error.stack);
});

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    // trustProxy: deployed behind a platform load balancer (Railway/Render/
    // etc.) - without it, req.ip is always the proxy's address (breaking
    // per-IP rate limiting) and req.protocol/hostname report the internal
    // http:// hop instead of the real public https:// origin (which the
    // x402 guard uses to build the resource URL the GoPlausible facilitator
    // catalogs for Bazaar discovery).
    new FastifyAdapter({ trustProxy: true }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      exceptionFactory: (errors: ValidationError[]) =>
        new BadRequestException({
          message: 'Validation failed',
          details: errors.map((error) => ({
            field: error.property,
            constraints: error.constraints,
          })),
        }),
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('SiteLenz')
    .setDescription(
      '⚠️ /v1/analyses/* has moved permanently to /v1/analyze/*\n\nWebsite Intelligence API',
    )
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  // NestJS's enableCors() doesn't correctly wire up preflight OPTIONS routes
  // under the Fastify adapter - register the Fastify plugin directly instead.
  await app.register(fastifyCors, {
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'X-PAYMENT',
      'X-Payment',
      'PAYMENT-SIGNATURE',
      'Authorization',
    ],
    // PAYMENT-REQUIRED (402 challenge) and PAYMENT-RESPONSE (settlement
    // receipt on success) are response headers a browser-based payer reads
    // across origins - without exposing them here the browser silently
    // hides both from client JS (flagged by a live x402 Doctor report).
    exposedHeaders: ['X-PAYMENT', 'PAYMENT-REQUIRED', 'PAYMENT-RESPONSE'],
    preflight: true,
    optionsSuccessStatus: 200,
  });

  // Serves public/logo.png at GET /logo.png - the only static asset this API
  // has, referenced by the x402-merchant extension (see x402.guard.ts) so
  // the facilitator's merchant listing has a logo. process.cwd(), not a
  // __dirname-relative path, for the same reason configuration.ts reads
  // package.json that way: ts-node (dev) and dist/src/main.js (prod) sit at
  // different depths from the repo root, but both run with cwd set to it.
  await app.register(fastifyStatic, {
    root: join(process.cwd(), 'public'),
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');
}
void bootstrap();
