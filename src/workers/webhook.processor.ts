import { Logger } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { WebhookDeliveryStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AppConfigService } from '../config';
import { WEBHOOK_JOB_NAME, WEBHOOK_QUEUE } from '../queue/queue.constants';
import {
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_REQUEST_TIMEOUT_MS,
  WEBHOOK_RETRY_DELAYS_MS,
} from '../webhooks/webhook.constants';
import {
  buildSignatureHeader,
  signWebhookPayload,
} from '../webhooks/webhook-signature.util';
import type { WebhookDeliveryJobData } from '../webhooks/webhook-delivery-job.interface';

interface DeliveryAttemptResult {
  success: boolean;
  responseStatus: number | null;
}

@Processor(WEBHOOK_QUEUE)
export class WebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly appConfigService: AppConfigService,
    @InjectQueue(WEBHOOK_QUEUE)
    private readonly webhookQueue: Queue<WebhookDeliveryJobData>,
  ) {
    super();
  }

  // Never throws — a delivery failure is recorded and retried via a new
  // delayed job we schedule ourselves, not via BullMQ's own attempts/backoff
  // (jobs are added without an `attempts` option, so we own the schedule).
  async process(job: Job<WebhookDeliveryJobData>): Promise<void> {
    const { webhookDeliveryId, analysisId, url, payload, attempt } = job.data;

    try {
      const { success, responseStatus } = await this.attemptDelivery(
        url,
        payload,
      );

      const isFinalAttempt = attempt >= WEBHOOK_MAX_ATTEMPTS;
      const nextAttempt = attempt + 1;
      const nextDelay = WEBHOOK_RETRY_DELAYS_MS[attempt];
      const willRetry = !success && !isFinalAttempt;

      await this.prisma.webhookDelivery.update({
        where: { id: webhookDeliveryId },
        data: {
          attempts: { increment: 1 },
          lastAttemptAt: new Date(),
          responseStatus,
          status: success
            ? WebhookDeliveryStatus.success
            : isFinalAttempt
              ? WebhookDeliveryStatus.failed
              : WebhookDeliveryStatus.pending,
          nextAttemptAt: willRetry ? new Date(Date.now() + nextDelay) : null,
        },
      });

      if (success) {
        this.logger.log(
          `Webhook delivered for analysis ${analysisId} (attempt ${attempt}, status ${responseStatus})`,
        );
        return;
      }

      if (isFinalAttempt) {
        this.logger.error(
          `Webhook delivery permanently failed for analysis ${analysisId} after ${attempt} attempts`,
        );
        return;
      }

      await this.webhookQueue.add(
        WEBHOOK_JOB_NAME,
        { ...job.data, attempt: nextAttempt },
        {
          // BullMQ rejects ":" in custom job ids (it's a Redis key delimiter).
          jobId: `${webhookDeliveryId}-attempt-${nextAttempt}`,
          delay: nextDelay,
        },
      );
    } catch (error) {
      this.logger.error(
        `Webhook processing error for analysis ${analysisId} (attempt ${attempt}): ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  private async attemptDelivery(
    url: string,
    payload: WebhookDeliveryJobData['payload'],
  ): Promise<DeliveryAttemptResult> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = signWebhookPayload(
      timestamp,
      payload,
      this.appConfigService.webhookSecret,
    );

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      WEBHOOK_REQUEST_TIMEOUT_MS,
    );

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-SiteLenz-Signature': buildSignatureHeader(timestamp, signature),
          'X-SiteLenz-Timestamp': timestamp,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      return { success: response.ok, responseStatus: response.status };
    } catch (error) {
      this.logger.warn(
        `Webhook request to ${url} failed: ${(error as Error).message}`,
      );
      return { success: false, responseStatus: null };
    } finally {
      clearTimeout(timer);
    }
  }
}
