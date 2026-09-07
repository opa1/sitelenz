import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { WebhookDeliveryStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { WEBHOOK_JOB_NAME, WEBHOOK_QUEUE } from '../queue/queue.constants';
import { WEBHOOK_RETRY_DELAYS_MS } from './webhook.constants';
import type { WebhookDeliveryJobData } from './webhook-delivery-job.interface';
import type { WebhookEvent, WebhookPayload } from './webhook-payload.interface';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(WEBHOOK_QUEUE)
    private readonly webhookQueue: Queue<WebhookDeliveryJobData>,
  ) {}

  /**
   * Creates the WebhookDelivery record and enqueues the first delivery
   * attempt. Only does fast local work (two DB calls + an enqueue) - the
   * actual HTTP round trip happens later in WebhookProcessor, so this
   * resolves quickly and never delays the caller.
   */
  async deliver(
    analysisId: string,
    event: WebhookEvent,
    payload: WebhookPayload,
  ): Promise<void> {
    const analysis = await this.prisma.analysis.findUnique({
      where: { id: analysisId },
      select: { webhookUrl: true },
    });
    const webhookUrl = analysis?.webhookUrl;
    if (!webhookUrl) {
      this.logger.warn(
        `deliver() called for analysis ${analysisId} with no webhookUrl configured - skipping`,
      );
      return;
    }

    const delivery = await this.prisma.webhookDelivery.create({
      data: {
        analysisId,
        url: webhookUrl,
        event,
        status: WebhookDeliveryStatus.pending,
        attempts: 0,
      },
    });

    const jobData: WebhookDeliveryJobData = {
      webhookDeliveryId: delivery.id,
      analysisId,
      url: webhookUrl,
      event,
      payload,
      attempt: 1,
    };

    await this.webhookQueue.add(WEBHOOK_JOB_NAME, jobData, {
      // BullMQ rejects ":" in custom job ids (it's a Redis key delimiter).
      jobId: `${delivery.id}-attempt-1`,
      delay: WEBHOOK_RETRY_DELAYS_MS[0],
    });
  }
}
