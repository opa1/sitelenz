import { Module } from '@nestjs/common';
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ConfigModule } from './config';
import { CommonModule } from './common/common.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { BrowserModule } from './common/browser/browser.module';
import { HttpLoggerMiddleware } from './common/middleware/http-logger.middleware';
import { QueueModule } from './queue/queue.module';
import { HealthModule } from './health/health.module';
import { WellKnownModule } from './well-known/well-known.module';
import { AnalysesModule } from './analyses/analyses.module';
import { AnalyzeModule } from './analyze/analyze.module';
import { WorkersModule } from './workers/workers.module';
import { AiModule } from './ai/ai.module';
import { StorageModule } from './storage/storage.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [
    ConfigModule,
    CommonModule,
    PrismaModule,
    BrowserModule,
    QueueModule,
    HealthModule,
    WellKnownModule,
    AnalysesModule,
    AnalyzeModule,
    WorkersModule,
    AiModule,
    StorageModule,
    WebhooksModule,
    // Two named tiers, one shared global guard (see the module-level
    // ThrottlerGuard docs - @nestjs/throttler's ThrottlerModule is @Global(),
    // so a second forRoot() call scoped to a feature module would collide
    // with this one's options/storage tokens rather than staying
    // independent). 'global' applies to every route by default. The
    // stricter 'analysis-create' tier is opted out of everywhere via
    // @SkipThrottle at the controller level and opted back in on just
    // POST /v1/analyses - see analyses.controller.ts and
    // health.controller.ts.
    ThrottlerModule.forRoot([
      { name: 'global', ttl: 60_000, limit: 200 },
      { name: 'analysis-create', ttl: 60_000, limit: 10 },
    ]),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(HttpLoggerMiddleware).forRoutes('*');
  }
}
