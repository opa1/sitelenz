import type {
  AnalyzeWebhookEvent,
  AnalyzeWebhookPayload,
} from './analyze-webhook-payload.interface';

export interface AnalyzeWebhookDeliveryJobData {
  analyzeWebhookDeliveryId: string;
  analyzeJobId: string;
  url: string;
  event: AnalyzeWebhookEvent;
  payload: AnalyzeWebhookPayload;
  /** 1-based attempt number this job represents. */
  attempt: number;
}
