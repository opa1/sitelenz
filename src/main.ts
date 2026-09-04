import type { ValidationError } from '@nestjs/common';
import { BadRequestException, Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import fastifyCors from '@fastify/cors';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

const processLogger = new Logger('Process');

// This is a long-running worker process, not a request/response script — a
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
    // etc.) — without it, req.ip is always the proxy's address (breaking
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
    .setDescription('Website Intelligence API')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  // NestJS's enableCors() doesn't correctly wire up preflight OPTIONS routes
  // under the Fastify adapter — register the Fastify plugin directly instead.
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
    exposedHeaders: ['X-PAYMENT'],
    preflight: true,
    optionsSuccessStatus: 200,
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');
}
void bootstrap();
