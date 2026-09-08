import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AnalyzeJobStatus, type Prisma } from '@prisma/client';
import type { FastifyRequest } from 'fastify';
import { PrismaService } from '../common/prisma/prisma.service';
import { UrlValidatorService } from '../common/utils/url-validator.service';
import { normalizeUrl } from '../common/utils/normalize-url.util';
import { sanitizeForJsonb } from '../common/utils/json-sanitize.util';
import { InvalidUrlException } from '../common/exceptions/invalid-url.exception';
import { AnalysisNotFailedException } from '../common/exceptions/analysis-not-failed.exception';
import { InsufficientFindingsException } from '../common/exceptions/insufficient-findings.exception';
import { generateAnalyzeJobId } from '../common/utils/id';
import {
  ANALYZE_AI_SUMMARY_JOB_NAME,
  ANALYZE_AI_SUMMARY_QUEUE,
  ANALYZE_BUSINESS_JOB_NAME,
  ANALYZE_BUSINESS_QUEUE,
  ANALYZE_FULL_JOB_NAME,
  ANALYZE_FULL_QUEUE,
  ANALYZE_PERFORMANCE_JOB_NAME,
  ANALYZE_PERFORMANCE_QUEUE,
  ANALYZE_SCREENSHOTS_JOB_NAME,
  ANALYZE_SCREENSHOTS_QUEUE,
  ANALYZE_SECURITY_JOB_NAME,
  ANALYZE_SECURITY_QUEUE,
  ANALYZE_SEO_JOB_NAME,
  ANALYZE_SEO_QUEUE,
  ANALYZE_STANDARD_JOB_NAME,
  ANALYZE_STANDARD_QUEUE,
  ANALYZE_TECHNOLOGY_JOB_NAME,
  ANALYZE_TECHNOLOGY_QUEUE,
  ANALYZE_UX_ACCESSIBILITY_JOB_NAME,
  ANALYZE_UX_ACCESSIBILITY_QUEUE,
} from '../queue/queue.constants';
import type { AnalyzeEndpoint, AnalyzeJobData } from './analyze-job.interface';
import { AnalyzeJobCreatedResponseDto } from './dto/analyze-job-created-response.dto';
import { AnalyzeJobStatusResponseDto } from './dto/analyze-job-status-response.dto';
import { AnalyzeResultPendingResponseDto } from './dto/analyze-result-pending-response.dto';
import { RetryAnalyzeJobResponseDto } from './dto/retry-analyze-job-response.dto';

export interface CreateAnalyzeJobParams {
  url: string;
  webhookUrl?: string;
  endpoint: AnalyzeEndpoint;
  req: FastifyRequest;
  /** ai-summary only - see AnalyzeJobData.findings. */
  findings?: Record<string, unknown>;
}

export type AnalyzeResultOutcome =
  | { ready: true; result: Record<string, unknown> }
  | { ready: false; pending: AnalyzeResultPendingResponseDto };

const JOB_NAME_BY_ENDPOINT: Record<AnalyzeEndpoint, string> = {
  technology: ANALYZE_TECHNOLOGY_JOB_NAME,
  seo: ANALYZE_SEO_JOB_NAME,
  security: ANALYZE_SECURITY_JOB_NAME,
  business: ANALYZE_BUSINESS_JOB_NAME,
  performance: ANALYZE_PERFORMANCE_JOB_NAME,
  'ux-accessibility': ANALYZE_UX_ACCESSIBILITY_JOB_NAME,
  screenshots: ANALYZE_SCREENSHOTS_JOB_NAME,
  'ai-summary': ANALYZE_AI_SUMMARY_JOB_NAME,
  standard: ANALYZE_STANDARD_JOB_NAME,
  full: ANALYZE_FULL_JOB_NAME,
};

/**
 * Shared helper each per-endpoint controller injects and delegates to - not
 * itself a `@Controller` / has no routes of its own. Centralizes the
 * AnalyzeJob CRUD + queueing logic common to every analyze endpoint.
 */
@Injectable()
export class BaseAnalyzeController {
  private readonly queues: Record<AnalyzeEndpoint, Queue<AnalyzeJobData>>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly urlValidator: UrlValidatorService,
    @InjectQueue(ANALYZE_TECHNOLOGY_QUEUE)
    technologyQueue: Queue<AnalyzeJobData>,
    @InjectQueue(ANALYZE_SEO_QUEUE) seoQueue: Queue<AnalyzeJobData>,
    @InjectQueue(ANALYZE_SECURITY_QUEUE)
    securityQueue: Queue<AnalyzeJobData>,
    @InjectQueue(ANALYZE_BUSINESS_QUEUE)
    businessQueue: Queue<AnalyzeJobData>,
    @InjectQueue(ANALYZE_PERFORMANCE_QUEUE)
    performanceQueue: Queue<AnalyzeJobData>,
    @InjectQueue(ANALYZE_UX_ACCESSIBILITY_QUEUE)
    uxAccessibilityQueue: Queue<AnalyzeJobData>,
    @InjectQueue(ANALYZE_SCREENSHOTS_QUEUE)
    screenshotsQueue: Queue<AnalyzeJobData>,
    @InjectQueue(ANALYZE_AI_SUMMARY_QUEUE)
    aiSummaryQueue: Queue<AnalyzeJobData>,
    @InjectQueue(ANALYZE_STANDARD_QUEUE)
    standardQueue: Queue<AnalyzeJobData>,
    @InjectQueue(ANALYZE_FULL_QUEUE) fullQueue: Queue<AnalyzeJobData>,
  ) {
    this.queues = {
      technology: technologyQueue,
      seo: seoQueue,
      security: securityQueue,
      business: businessQueue,
      performance: performanceQueue,
      'ux-accessibility': uxAccessibilityQueue,
      screenshots: screenshotsQueue,
      'ai-summary': aiSummaryQueue,
      standard: standardQueue,
      full: fullQueue,
    };
  }

  async createJob(
    params: CreateAnalyzeJobParams,
  ): Promise<AnalyzeJobCreatedResponseDto> {
    const isAiSummary = params.endpoint === 'ai-summary';

    if (isAiSummary && Object.keys(params.findings ?? {}).length === 0) {
      throw new InsufficientFindingsException();
    }

    // ai-summary never crawls the URL - it's descriptive metadata about
    // what the findings are for, so only normalize the string form rather
    // than running it through UrlValidatorService's SSRF/DNS-resolution
    // check (which would be pointless network work for a URL nothing ever
    // fetches).
    let normalizedUrl: string;
    if (isAiSummary) {
      try {
        normalizedUrl = normalizeUrl(params.url);
      } catch {
        throw new InvalidUrlException('Malformed URL');
      }
    } else {
      const validation = await this.urlValidator.validate(params.url);
      if (!validation.valid) {
        throw new InvalidUrlException(validation.reason);
      }
      normalizedUrl = validation.normalizedUrl;
    }

    const analyzeJobId = generateAnalyzeJobId();
    const job = await this.prisma.analyzeJob.create({
      data: {
        id: analyzeJobId,
        endpoint: params.endpoint,
        url: normalizedUrl,
        normalizedUrl,
        status: AnalyzeJobStatus.queued,
        progressStage: 'queued',
        webhookUrl: params.webhookUrl ?? null,
        // Client-supplied JSON (ai-summary) - same jsonb NUL/lone-surrogate
        // rejection risk as any other Json column, see crawl-cache.service.ts.
        findings: params.findings
          ? (sanitizeForJsonb(params.findings) as Prisma.InputJsonValue)
          : undefined,
      },
    });

    const jobData: AnalyzeJobData = {
      analyzeJobId,
      endpoint: params.endpoint,
      url: normalizedUrl,
      normalizedUrl,
      ...(params.findings ? { findings: params.findings } : {}),
    };
    await this.queues[params.endpoint].add(
      JOB_NAME_BY_ENDPOINT[params.endpoint],
      jobData,
      { jobId: analyzeJobId },
    );

    return {
      analyzeJobId: job.id,
      status: job.status,
      endpoint: job.endpoint,
      createdAt: job.createdAt.toISOString(),
    };
  }

  async getJob(id: string): Promise<AnalyzeJobStatusResponseDto> {
    const job = await this.prisma.analyzeJob.findUnique({ where: { id } });
    if (!job) {
      throw new NotFoundException(`Analyze job "${id}" not found`);
    }

    return {
      analyzeJobId: job.id,
      endpoint: job.endpoint,
      status: job.status,
      progressStage: job.progressStage,
      createdAt: job.createdAt.toISOString(),
      completedAt: job.completedAt ? job.completedAt.toISOString() : null,
      ...(job.status === AnalyzeJobStatus.failed && job.errorMessage
        ? { errorMessage: job.errorMessage }
        : {}),
    };
  }

  async getResult(id: string): Promise<AnalyzeResultOutcome> {
    const job = await this.prisma.analyzeJob.findUnique({ where: { id } });
    if (!job) {
      throw new NotFoundException(`Analyze job "${id}" not found`);
    }

    if (job.status !== AnalyzeJobStatus.completed) {
      return {
        ready: false,
        pending: {
          analyzeJobId: job.id,
          status: job.status as 'queued' | 'running' | 'failed',
          message: 'Analysis not yet complete',
        },
      };
    }

    return { ready: true, result: job.result as Record<string, unknown> };
  }

  async retryJob(id: string): Promise<RetryAnalyzeJobResponseDto> {
    const job = await this.prisma.analyzeJob.findUnique({ where: { id } });
    if (!job) {
      throw new NotFoundException(`Analyze job "${id}" not found`);
    }
    if (job.status !== AnalyzeJobStatus.failed) {
      throw new AnalysisNotFailedException();
    }

    const endpoint = job.endpoint as AnalyzeEndpoint;
    const queue = this.queues[endpoint];

    const updated = await this.prisma.analyzeJob.update({
      where: { id },
      data: {
        status: AnalyzeJobStatus.queued,
        progressStage: 'queued',
        completedAt: null,
        errorMessage: null,
      },
    });

    // The original job (same jobId) is still sitting in Redis in its failed
    // state - BullMQ treats add() with an existing jobId as a duplicate and
    // silently no-ops rather than re-queuing it, so it must be removed first.
    await queue.remove(id);
    await queue.add(
      JOB_NAME_BY_ENDPOINT[endpoint],
      {
        analyzeJobId: updated.id,
        endpoint,
        url: updated.url,
        normalizedUrl: updated.normalizedUrl,
        // Only ai-summary jobs ever have findings persisted; undefined for
        // every other endpoint, so this is a no-op for them.
        ...(updated.findings
          ? { findings: updated.findings as Record<string, unknown> }
          : {}),
      },
      { jobId: id },
    );

    return {
      analyzeJobId: updated.id,
      status: updated.status,
      endpoint: updated.endpoint,
      retried: true,
    };
  }
}
