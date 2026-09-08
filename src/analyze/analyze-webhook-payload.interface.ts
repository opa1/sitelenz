export interface AnalyzeWebhookCompletedPayload {
  event: 'analyze.completed';
  analyzeJobId: string;
  endpoint: string;
  status: 'completed';
  resultUrl: string;
}

export interface AnalyzeWebhookFailedPayload {
  event: 'analyze.failed';
  analyzeJobId: string;
  endpoint: string;
  status: 'failed';
  error: {
    code: string;
    message: string;
  };
}

export type AnalyzeWebhookPayload =
  AnalyzeWebhookCompletedPayload | AnalyzeWebhookFailedPayload;
export type AnalyzeWebhookEvent = AnalyzeWebhookPayload['event'];
