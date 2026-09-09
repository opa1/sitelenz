import { Logger } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { WebhookDeliveryStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { AppConfigService } from '../config';
import {
  ANALYZE_WEBHOOK_JOB_NAME,
  ANALYZE_WEBHOOK_QUEUE,
  WORKER_POLL_TUNING,
} from '../queue/queue.constants';
import {
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_REQUEST_TIMEOUT_MS,
  WEBHOOK_RETRY_DELAYS_MS,
} from '../webhooks/webhook.constants';
import {
  buildSignatureHeader,
  signWebhookPayload,
} from '../webhooks/webhook-signature.util';
import type { AnalyzeWebhookDeliveryJobData } from './analyze-webhook-delivery-job.interface';

interface DeliveryAttemptResult {
  success: boolean;
  responseStatus: number | null;
}

@Processor(ANALYZE_WEBHOOK_QUEUE, {
  lockDuration: 300_000,
  lockRenewTime: 60_000,
  ...WORKER_POLL_TUNING,
})
export class AnalyzeWebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(AnalyzeWebhookProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly appConfigService: AppConfigService,
    @InjectQueue(ANALYZE_WEBHOOK_QUEUE)
    private readonly analyzeWebhookQueue: Queue<AnalyzeWebhookDeliveryJobData>,
  ) {
    super();
  }

  // Never throws - a delivery failure is recorded and retried via a new
  // delayed job we schedule ourselves, not via BullMQ's own attempts/backoff
  // (jobs are added without an `attempts` option, so we own the schedule).
  async process(job: Job<AnalyzeWebhookDeliveryJobData>): Promise<void> {
    const { analyzeWebhookDeliveryId, analyzeJobId, url, payload, attempt } =
      job.data;

    try {
      const { success, responseStatus } = await this.attemptDelivery(
        url,
        payload,
      );

      const isFinalAttempt = attempt >= WEBHOOK_MAX_ATTEMPTS;
      const nextAttempt = attempt + 1;
      const nextDelay = WEBHOOK_RETRY_DELAYS_MS[attempt];
      const willRetry = !success && !isFinalAttempt;

      await this.prisma.analyzeWebhookDelivery.update({
        where: { id: analyzeWebhookDeliveryId },
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
          `Webhook delivered for analyze job ${analyzeJobId} (attempt ${attempt}, status ${responseStatus})`,
        );
        return;
      }

      if (isFinalAttempt) {
        this.logger.error(
          `Webhook delivery permanently failed for analyze job ${analyzeJobId} after ${attempt} attempts`,
        );
        return;
      }

      await this.analyzeWebhookQueue.add(
        ANALYZE_WEBHOOK_JOB_NAME,
        { ...job.data, attempt: nextAttempt },
        {
          // BullMQ rejects ":" in custom job ids (it's a Redis key delimiter).
          jobId: `${analyzeWebhookDeliveryId}-attempt-${nextAttempt}`,
          delay: nextDelay,
        },
      );
    } catch (error) {
      this.logger.error(
        `Webhook processing error for analyze job ${analyzeJobId} (attempt ${attempt}): ${(error as Error).message}`,
        (error as Error).stack,
      );
    }
  }

  private async attemptDelivery(
    url: string,
    payload: AnalyzeWebhookDeliveryJobData['payload'],
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
