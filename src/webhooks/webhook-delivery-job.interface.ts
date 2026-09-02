import type { WebhookEvent, WebhookPayload } from './webhook-payload.interface';

export interface WebhookDeliveryJobData {
  webhookDeliveryId: string;
  analysisId: string;
  url: string;
  event: WebhookEvent;
  payload: WebhookPayload;
  /** 1-based attempt number this job represents. */
  attempt: number;
}
