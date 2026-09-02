import { Inject, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import type { BrowserContext } from 'playwright';
import { AnalysisStatus, Prisma, ScreenshotType } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { BrowserService } from '../common/browser/browser.service';
import { ObservationCollector } from '../common/browser/observation-collector.service';
import { LighthouseService } from '../common/browser/lighthouse.service';
import { BlockerDismissalService } from '../common/browser/blocker-dismissal.service';
import { CloudinaryService } from '../storage/cloudinary.service';
import { TechnologyAnalyzerService } from '../analyzers/technology/technology-analyzer.service';
import { SeoAnalyzerService } from '../analyzers/seo/seo-analyzer.service';
import { SecurityAnalyzerService } from '../analyzers/security/security-analyzer.service';
import { PerformanceAnalyzerService } from '../analyzers/performance/performance-analyzer.service';
import { BusinessAnalyzerService } from '../analyzers/business/business-analyzer.service';
import { UxAnalyzerService } from '../analyzers/ux/ux-analyzer.service';
import { AiInputBuilderService } from '../ai/ai-input-builder.service';
import { AI_PROVIDER } from '../ai/ai-provider.interface';
import type { AIProvider, AiResult } from '../ai/ai-provider.interface';
import { WebhookService } from '../webhooks/webhook.service';
import type {
  AnalysisReport,
  ScreenshotResult,
} from '../common/interfaces/analysis-report.interface';
import { ANALYSIS_QUEUE } from '../queue/queue.constants';
import type { AnalysisJobData } from '../queue/analysis-job.interface';

const PROGRESS_STAGE = {
  LAUNCHING_BROWSER: 'launching_browser',
  FETCHING_WEBSITE: 'fetching_website',
  RENDERING: 'rendering',
  TAKING_SCREENSHOT: 'taking_screenshot',
  ANALYZING: 'analyzing',
  AI_ANALYSIS: 'ai_analysis',
  STORING_RESULTS: 'storing_results',
  SENDING_WEBHOOK: 'sending_webhook',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

@Processor(ANALYSIS_QUEUE)
export class AnalysisProcessor extends WorkerHost {
  private readonly logger = new Logger(AnalysisProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly browserService: BrowserService,
    private readonly observationCollector: ObservationCollector,
    private readonly lighthouseService: LighthouseService,
    private readonly blockerDismissalService: BlockerDismissalService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly technologyAnalyzer: TechnologyAnalyzerService,
    private readonly seoAnalyzer: SeoAnalyzerService,
    private readonly securityAnalyzer: SecurityAnalyzerService,
    private readonly performanceAnalyzer: PerformanceAnalyzerService,
    private readonly businessAnalyzer: BusinessAnalyzerService,
    private readonly uxAnalyzer: UxAnalyzerService,
    private readonly aiInputBuilder: AiInputBuilderService,
    @Inject(AI_PROVIDER) private readonly aiProvider: AIProvider,
    private readonly webhookService: WebhookService,
  ) {
    super();
  }

  async process(job: Job<AnalysisJobData>): Promise<void> {
    const { analysisId, url, analysisType, webhookUrl } = job.data;
    const deep = analysisType === 'deep';
    const startedAt = Date.now();

    let context: BrowserContext | null = null;
    let mobileContext: BrowserContext | null = null;

    try {
      await this.updateStatusAndStage(
        analysisId,
        AnalysisStatus.running,
        PROGRESS_STAGE.LAUNCHING_BROWSER,
      );
      context = await this.browserService.acquireContext();

      await this.updateStage(analysisId, PROGRESS_STAGE.FETCHING_WEBSITE);
      const observations = await this.observationCollector.collect(
        context,
        url,
      );

      await this.updateStage(analysisId, PROGRESS_STAGE.RENDERING);
      observations.lighthouseResult = await this.lighthouseService.run(
        observations.url,
      );

      await this.updateStage(analysisId, PROGRESS_STAGE.TAKING_SCREENSHOT);
      const screenshots: ScreenshotResult[] = [];
      screenshots.push(
        await this.captureScreenshot(
          context,
          observations.url,
          analysisId,
          'desktop',
        ),
      );
      if (deep) {
        mobileContext = await this.browserService.acquireMobileContext();
        screenshots.push(
          await this.captureScreenshot(
            mobileContext,
            observations.url,
            analysisId,
            'mobile',
          ),
        );
      }

      await this.updateStage(analysisId, PROGRESS_STAGE.ANALYZING);
      const analyzerOptions = { deep };
      // Run in sequence, not in parallel — a later analyzer may eventually
      // want an earlier one's output as context.
      const technologyResult = await this.technologyAnalyzer.analyze(
        observations,
        analyzerOptions,
      );
      const seoResult = await this.seoAnalyzer.analyze(
        observations,
        analyzerOptions,
      );
      const securityResult = await this.securityAnalyzer.analyze(
        observations,
        analyzerOptions,
      );
      const performanceResult = await this.performanceAnalyzer.analyze(
        observations,
        analyzerOptions,
      );
      const businessResult = await this.businessAnalyzer.analyze(
        observations,
        analyzerOptions,
      );
      const uxResult = await this.uxAnalyzer.analyze(
        observations,
        analyzerOptions,
      );

      await this.updateStage(analysisId, PROGRESS_STAGE.AI_ANALYSIS);
      let aiResult: AiResult;
      try {
        const condensedInput = this.aiInputBuilder.build(
          {
            technology: technologyResult,
            seo: seoResult,
            security: securityResult,
            performance: performanceResult,
            business: businessResult,
            ux: uxResult,
          },
          { deep },
        );
        aiResult = await this.aiProvider.interpret(condensedInput, { deep });
      } catch (error) {
        this.logger.error(
          `AI interpretation failed for analysis ${analysisId}: ${(error as Error).message}`,
          (error as Error).stack,
        );
        aiResult = this.buildFallbackAiResult();
      }

      await this.updateStage(analysisId, PROGRESS_STAGE.STORING_RESULTS);
      const report: AnalysisReport = {
        analysisId,
        url,
        analysisType,
        website: {
          finalUrl: observations.url,
          statusCode: observations.statusCode,
          redirectChain: observations.redirectChain,
        },
        technology: technologyResult,
        seo: seoResult,
        security: securityResult,
        performance: performanceResult,
        business: businessResult,
        ux: uxResult,
        ai: aiResult,
        screenshots,
        metadata: {
          analysisCompletedAt: new Date().toISOString(),
          analysisDurationMs: Date.now() - startedAt,
        },
      };
      const reportJson = report as unknown as Prisma.InputJsonValue;
      await this.prisma.analysisReport.upsert({
        where: { analysisId },
        create: { analysisId, report: reportJson },
        update: { report: reportJson },
      });

      await this.updateStage(analysisId, PROGRESS_STAGE.SENDING_WEBHOOK);
      if (webhookUrl) {
        // enqueue and move on — the actual HTTP delivery (and its retries)
        // happen asynchronously in WebhookProcessor, not on this critical path.
        await this.webhookService
          .deliver(analysisId, 'analysis.completed', {
            event: 'analysis.completed',
            analysisId,
            status: 'completed',
            reportUrl: `/v1/analyses/${analysisId}/report`,
          })
          .catch((error: Error) => {
            this.logger.error(
              `Failed to enqueue completion webhook for analysis ${analysisId}: ${error.message}`,
            );
          });
      } else {
        this.logger.log(
          `No webhookUrl configured for analysis ${analysisId}, skipping webhook`,
        );
      }

      await this.prisma.analysis.update({
        where: { id: analysisId },
        data: {
          status: AnalysisStatus.completed,
          progressStage: PROGRESS_STAGE.COMPLETED,
          completedAt: new Date(),
        },
      });
      this.logger.log(`Completed analysis ${analysisId}`);
    } catch (error) {
      const err = error as Error & { code?: string };
      this.logger.error(
        `Analysis ${analysisId} failed [${err.code ?? 'UNKNOWN_ERROR'}]: ${err.message}`,
        err.stack,
      );
      await this.prisma.analysis
        .update({
          where: { id: analysisId },
          data: {
            status: AnalysisStatus.failed,
            progressStage: PROGRESS_STAGE.FAILED,
          },
        })
        .catch((updateError: Error) => {
          this.logger.error(
            `Failed to mark analysis ${analysisId} as failed: ${updateError.message}`,
          );
        });

      if (webhookUrl) {
        await this.webhookService
          .deliver(analysisId, 'analysis.failed', {
            event: 'analysis.failed',
            analysisId,
            status: 'failed',
            error: {
              code: err.code ?? 'UNKNOWN_ERROR',
              message: err.message,
            },
          })
          .catch((webhookError: Error) => {
            this.logger.error(
              `Failed to enqueue failure webhook for analysis ${analysisId}: ${webhookError.message}`,
            );
          });
      }
    } finally {
      if (context) {
        await context.close().catch(() => undefined);
      }
      if (mobileContext) {
        await mobileContext.close().catch(() => undefined);
      }
    }
  }

  private async captureScreenshot(
    context: BrowserContext,
    url: string,
    analysisId: string,
    type: 'desktop' | 'mobile',
  ): Promise<ScreenshotResult> {
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'load' });

      const dismissal = await this.blockerDismissalService
        .dismissBlockers(page)
        .catch((error: Error) => {
          this.logger.warn(
            `Blocker dismissal failed for analysis ${analysisId} (${type}): ${error.message}`,
          );
          return { dismissed: false, method: 'none' as const };
        });
      if (dismissal.dismissed) {
        this.logger.log(
          `Dismissed a page blocker for analysis ${analysisId} (${type}) via ${dismissal.method}`,
        );
      }

      // Viewport-only, not the full scrolled page — a fixed-size frame
      // rather than an arbitrarily tall image.
      const buffer = await page.screenshot({ fullPage: false, type: 'png' });
      const uploaded = await this.cloudinaryService.uploadScreenshot(
        buffer,
        analysisId,
        type,
      );
      await this.prisma.screenshot.create({
        data: {
          analysisId,
          type:
            type === 'desktop' ? ScreenshotType.desktop : ScreenshotType.mobile,
          cloudinaryUrl: uploaded.url,
          cloudinaryPublicId: uploaded.publicId,
        },
      });
      return { type, url: uploaded.url, blockerDismissed: dismissal.dismissed };
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  private buildFallbackAiResult(): AiResult {
    return {
      summary: 'AI interpretation unavailable',
      strengths: [],
      weaknesses: [],
      notableFindings: [],
      technicalInterpretation: '',
      businessInterpretation: '',
      recommendations: [],
      modelUsed: 'fallback',
      interpretedAt: new Date().toISOString(),
    };
  }

  private updateStage(analysisId: string, stage: string): Promise<unknown> {
    return this.prisma.analysis.update({
      where: { id: analysisId },
      data: { progressStage: stage },
    });
  }

  private updateStatusAndStage(
    analysisId: string,
    status: AnalysisStatus,
    stage: string,
  ): Promise<unknown> {
    return this.prisma.analysis.update({
      where: { id: analysisId },
      data: { status, progressStage: stage },
    });
  }
}
