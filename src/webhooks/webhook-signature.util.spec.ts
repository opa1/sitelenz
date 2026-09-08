import { createHmac } from 'node:crypto';
import {
  buildSignatureHeader,
  signWebhookPayload,
} from './webhook-signature.util';

describe('signWebhookPayload', () => {
  const secret = 'test-secret';
  const timestamp = '1700000000';
  const payload = { event: 'analysis.completed', id: 'sl_aj_123' };

  it('computes HMAC-SHA256 over `{timestamp}.{json}` as hex', () => {
    const expected = createHmac('sha256', secret)
      .update(`${timestamp}.${JSON.stringify(payload)}`)
      .digest('hex');
    expect(signWebhookPayload(timestamp, payload, secret)).toBe(expected);
  });

  it('is deterministic for the same inputs', () => {
    expect(signWebhookPayload(timestamp, payload, secret)).toBe(
      signWebhookPayload(timestamp, payload, secret),
    );
  });

  it('changes when the secret changes', () => {
    expect(signWebhookPayload(timestamp, payload, secret)).not.toBe(
      signWebhookPayload(timestamp, payload, 'other-secret'),
    );
  });

  it('changes when the timestamp changes (replay binding)', () => {
    expect(signWebhookPayload(timestamp, payload, secret)).not.toBe(
      signWebhookPayload('1700000001', payload, secret),
    );
  });
});

describe('buildSignatureHeader', () => {
  it('formats the header as `t=<ts>,v1=<sig>`', () => {
    expect(buildSignatureHeader('1700000000', 'abc123')).toBe(
      't=1700000000,v1=abc123',
    );
  });
});
