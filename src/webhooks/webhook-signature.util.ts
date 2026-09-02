import { createHmac } from 'node:crypto';

/**
 * Signature input is `{timestamp}.{JSON.stringify(payload)}` — clients
 * verify by recomputing this HMAC-SHA256 over the raw request body using
 * the timestamp from X-SiteLenz-Timestamp.
 */
export function signWebhookPayload(
  timestamp: string,
  payload: unknown,
  secret: string,
): string {
  const signedContent = `${timestamp}.${JSON.stringify(payload)}`;
  return createHmac('sha256', secret).update(signedContent).digest('hex');
}

export function buildSignatureHeader(
  timestamp: string,
  signature: string,
): string {
  return `t=${timestamp},v1=${signature}`;
}
