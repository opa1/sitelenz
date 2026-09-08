import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { WebhookDeliveryStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  ANALYZE_WEBHOOK_JOB_NAME,
  ANALYZE_WEBHOOK_QUEUE,
} from '../queue/queue.constants';
import { WEBHOOK_RETRY_DELAYS_MS } from '../webhooks/webhook.constants';
import type { AnalyzeWebhookDeliveryJobData } from './analyze-webhook-delivery-job.interface';
import type {
  AnalyzeWebhookEvent,
  AnalyzeWebhookPayload,
} from './analyze-webhook-payload.interface';

@Injectable()
export class AnalyzeWebhookService {
  private readonly logger = new Logger(AnalyzeWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(ANALYZE_WEBHOOK_QUEUE)
    private readonly analyzeWebhookQueue: Queue<AnalyzeWebhookDeliveryJobData>,
  ) {}

  /**
   * Creates the AnalyzeWebhookDelivery record and enqueues the first
   * delivery attempt. Only does fast local work (two DB calls + an enqueue)
   * - the actual HTTP round trip happens later in AnalyzeWebhookProcessor,
   * so this resolves quickly and never delays the caller.
   */
  async deliver(
    analyzeJobId: string,
    event: AnalyzeWebhookEvent,
    payload: AnalyzeWebhookPayload,
  ): Promise<void> {
    const analyzeJob = await this.prisma.analyzeJob.findUnique({
      where: { id: analyzeJobId },
      select: { webhookUrl: true },
    });
    const webhookUrl = analyzeJob?.webhookUrl;
    if (!webhookUrl) {
      this.logger.warn(
        `deliver() called for analyze job ${analyzeJobId} with no webhookUrl configured - skipping`,
      );
      return;
    }

    const delivery = await this.prisma.analyzeWebhookDelivery.create({
      data: {
        analyzeJobId,
        url: webhookUrl,
        event,
        status: WebhookDeliveryStatus.pending,
        attempts: 0,
      },
    });

    const jobData: AnalyzeWebhookDeliveryJobData = {
      analyzeWebhookDeliveryId: delivery.id,
      analyzeJobId,
      url: webhookUrl,
      event,
      payload,
      attempt: 1,
    };

    await this.analyzeWebhookQueue.add(ANALYZE_WEBHOOK_JOB_NAME, jobData, {
      // BullMQ rejects ":" in custom job ids (it's a Redis key delimiter).
      jobId: `${delivery.id}-attempt-1`,
      delay: WEBHOOK_RETRY_DELAYS_MS[0],
    });
  }
}
