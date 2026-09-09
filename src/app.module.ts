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
import { AnalyzeModule } from './analyze/analyze.module';
import { TechnologyAnalyzeModule } from './analyze/technology/technology.module';
import { SeoAnalyzeModule } from './analyze/seo/seo.module';
import { SecurityAnalyzeModule } from './analyze/security/security.module';
import { BusinessAnalyzeModule } from './analyze/business/business.module';
import { PerformanceAnalyzeModule } from './analyze/performance/performance.module';
import { UxAccessibilityAnalyzeModule } from './analyze/ux-accessibility/ux-accessibility.module';
import { ScreenshotsAnalyzeModule } from './analyze/screenshots/screenshots.module';
import { AiSummaryAnalyzeModule } from './analyze/ai-summary/ai-summary.module';
import { StandardAnalyzeModule } from './analyze/standard/standard.module';
import { FullAnalyzeModule } from './analyze/full/full.module';
import { AiModule } from './ai/ai.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    ConfigModule,
    CommonModule,
    PrismaModule,
    BrowserModule,
    QueueModule,
    HealthModule,
    WellKnownModule,
    AnalyzeModule,
    TechnologyAnalyzeModule,
    SeoAnalyzeModule,
    SecurityAnalyzeModule,
    BusinessAnalyzeModule,
    PerformanceAnalyzeModule,
    UxAccessibilityAnalyzeModule,
    ScreenshotsAnalyzeModule,
    AiSummaryAnalyzeModule,
    StandardAnalyzeModule,
    FullAnalyzeModule,
    AiModule,
    StorageModule,
    // Two named tiers, one shared global guard (see the module-level
    // ThrottlerGuard docs - @nestjs/throttler's ThrottlerModule is @Global(),
    // so a second forRoot() call scoped to a feature module would collide
    // with this one's options/storage tokens rather than staying
    // independent). 'global' applies to every route by default. The
    // stricter 'analysis-create' tier is opted out of everywhere via
    // @SkipThrottle at the controller level and opted back in on just
    // POST /v1/analyze/* - see the analyze controllers and
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
