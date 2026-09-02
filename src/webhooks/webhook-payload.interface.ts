export interface WebhookCompletedPayload {
  event: 'analysis.completed';
  analysisId: string;
  status: 'completed';
  reportUrl: string;
}

export interface WebhookFailedPayload {
  event: 'analysis.failed';
  analysisId: string;
  status: 'failed';
  error: {
    code: string;
    message: string;
  };
}

export type WebhookPayload = WebhookCompletedPayload | WebhookFailedPayload;
export type WebhookEvent = WebhookPayload['event'];
