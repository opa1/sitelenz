import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Analysis, AnalysisStatus, AnalysisType } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { UrlValidatorService } from '../common/utils/url-validator.service';
import { InvalidUrlException } from '../common/exceptions/invalid-url.exception';
import { CapacityExceededException } from '../common/exceptions/capacity-exceeded.exception';
import { AnalysisNotFailedException } from '../common/exceptions/analysis-not-failed.exception';
import { AppConfigService } from '../config';
import { generateAnalysisId } from '../common/utils/id';
import { ANALYSIS_JOB_NAME, ANALYSIS_QUEUE } from '../queue/queue.constants';
import type { AnalysisJobData } from '../queue/analysis-job.interface';
import type { AnalysisReport } from '../common/interfaces/analysis-report.interface';
import { CreateAnalysisDto } from './dto/create-analysis.dto';
import { CreateAnalysisResponseDto } from './dto/create-analysis-response.dto';
import { AnalysisStatusResponseDto } from './dto/analysis-status-response.dto';
import { AnalysisReportPendingResponseDto } from './dto/analysis-report-pending-response.dto';
import { RetryAnalysisResponseDto } from './dto/retry-analysis-response.dto';

export type AnalysisReportResult =
  | { ready: true; report: AnalysisReport }
  | { ready: false; pending: AnalysisReportPendingResponseDto };

@Injectable()
export class AnalysesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly urlValidator: UrlValidatorService,
    private readonly appConfigService: AppConfigService,
    @InjectQueue(ANALYSIS_QUEUE)
    private readonly analysisQueue: Queue<AnalysisJobData>,
  ) {}

  async createAnalysis(
    dto: CreateAnalysisDto,
  ): Promise<CreateAnalysisResponseDto> {
    const validation = await this.urlValidator.validate(dto.url);
    if (!validation.valid) {
      throw new InvalidUrlException(validation.reason);
    }
    const { normalizedUrl } = validation;

    const cached = await this.findCachedAnalysis(normalizedUrl, dto.analysis);
    if (cached) {
      return {
        analysisId: cached.id,
        status: cached.status,
        analysis: cached.analysisType,
        createdAt: cached.createdAt.toISOString(),
        cached: true,
      };
    }

    // Admission control, independent of the IP-based rate limit — caps how
    // much work the pipeline has in flight, regardless of who's asking.
    const runningCount = await this.prisma.analysis.count({
      where: { status: AnalysisStatus.running },
    });
    if (runningCount >= this.appConfigService.maxConcurrentAnalyses) {
      throw new CapacityExceededException();
    }

    const analysisId = generateAnalysisId();

    const analysis = await this.prisma.analysis.create({
      data: {
        id: analysisId,
        url: normalizedUrl,
        analysisType: dto.analysis,
        status: AnalysisStatus.queued,
        progressStage: 'queued',
        webhookUrl: dto.webhookUrl ?? null,
      },
    });

    await this.analysisQueue.add(
      ANALYSIS_JOB_NAME,
      {
        analysisId,
        url: normalizedUrl,
        analysisType: dto.analysis,
        webhookUrl: dto.webhookUrl ?? null,
      },
      { jobId: analysisId },
    );

    return {
      analysisId: analysis.id,
      status: analysis.status,
      analysis: analysis.analysisType,
      createdAt: analysis.createdAt.toISOString(),
    };
  }

  async getAnalysisStatus(id: string): Promise<AnalysisStatusResponseDto> {
    const analysis = await this.prisma.analysis.findUnique({
      where: { id },
    });
    if (!analysis) {
      throw new NotFoundException(`Analysis "${id}" not found`);
    }

    return {
      analysisId: analysis.id,
      status: analysis.status,
      analysis: analysis.analysisType,
      progress: analysis.progressStage,
      createdAt: analysis.createdAt.toISOString(),
      completedAt: analysis.completedAt
        ? analysis.completedAt.toISOString()
        : null,
      ...(analysis.status === AnalysisStatus.failed && analysis.errorMessage
        ? { errorMessage: analysis.errorMessage }
        : {}),
    };
  }

  async getAnalysisReport(id: string): Promise<AnalysisReportResult> {
    const analysis = await this.prisma.analysis.findUnique({
      where: { id },
    });
    if (!analysis) {
      throw new NotFoundException(`Analysis "${id}" not found`);
    }

    if (analysis.status !== AnalysisStatus.completed) {
      return {
        ready: false,
        pending: {
          analysisId: analysis.id,
          status: analysis.status,
          message: 'Analysis is not yet complete',
        },
      };
    }

    const report = await this.prisma.analysisReport.findUnique({
      where: { analysisId: id },
    });
    if (!report) {
      throw new NotFoundException(`Report for analysis "${id}" not found`);
    }

    return { ready: true, report: report.report as unknown as AnalysisReport };
  }

  async retryAnalysis(id: string): Promise<RetryAnalysisResponseDto> {
    const analysis = await this.prisma.analysis.findUnique({
      where: { id },
    });
    if (!analysis) {
      throw new NotFoundException(`Analysis "${id}" not found`);
    }
    if (analysis.status !== AnalysisStatus.failed) {
      throw new AnalysisNotFailedException();
    }

    const updated = await this.prisma.analysis.update({
      where: { id },
      data: {
        status: AnalysisStatus.queued,
        progressStage: 'queued',
        completedAt: null,
        errorMessage: null,
      },
    });

    // The original job (same jobId) is still sitting in Redis in its failed
    // state — BullMQ treats add() with an existing jobId as a duplicate and
    // silently no-ops rather than re-queuing it, so it must be removed
    // first for the retry to actually run.
    await this.analysisQueue.remove(id);
    await this.analysisQueue.add(
      ANALYSIS_JOB_NAME,
      {
        analysisId: updated.id,
        url: updated.url,
        analysisType: updated.analysisType,
        webhookUrl: updated.webhookUrl,
      },
      { jobId: id },
    );

    return {
      analysisId: updated.id,
      status: updated.status,
      analysis: updated.analysisType,
      retried: true,
    };
  }

  private findCachedAnalysis(
    url: string,
    analysisType: AnalysisType,
  ): Promise<Analysis | null> {
    const cutoff = new Date(
      Date.now() - this.appConfigService.analysisCacheTtlHours * 60 * 60 * 1000,
    );
    return this.prisma.analysis.findFirst({
      where: {
        url,
        analysisType,
        status: AnalysisStatus.completed,
        completedAt: { gte: cutoff },
      },
      orderBy: { completedAt: 'desc' },
    });
  }
}
