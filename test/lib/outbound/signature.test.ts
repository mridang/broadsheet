import { createHmac, randomUUID } from 'node:crypto';
import { describe, expect, it } from '@jest/globals';

import { signatureHeaders } from '@/lib/outbound/signature';

describe('signatureHeaders', () => {
  it('signs the timestamp and body with HMAC-SHA256 under the secret', async () => {
    const secret = randomUUID();
    const expected = createHmac('sha256', secret)
      .update('1700000000.{"a":1}')
      .digest('hex');
    expect(await signatureHeaders(secret, '{"a":1}', 1_700_000_000)).toEqual({
      'Webhook-Timestamp': '1700000000',
      'Webhook-Signature': `sha256=${expected}`,
    });
  });

  it('gives another signature for another body', async () => {
    const a = await signatureHeaders('s', 'one', 1);
    const b = await signatureHeaders('s', 'two', 1);
    expect(a['Webhook-Signature']).not.toBe(b['Webhook-Signature']);
  });
});
