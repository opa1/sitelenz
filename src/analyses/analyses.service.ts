import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Analysis, AnalysisStatus, AnalysisType } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { UrlValidatorService } from '../common/utils/url-validator.service';
import { InvalidUrlException } from '../common/exceptions/invalid-url.exception';
import { AppConfigService } from '../config';
import { generateAnalysisId } from '../common/utils/id';
import { ANALYSIS_JOB_NAME, ANALYSIS_QUEUE } from '../queue/queue.constants';
import type { AnalysisJobData } from '../queue/analysis-job.interface';
import { CreateAnalysisDto } from './dto/create-analysis.dto';
import { CreateAnalysisResponseDto } from './dto/create-analysis-response.dto';
import { AnalysisStatusResponseDto } from './dto/analysis-status-response.dto';

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
