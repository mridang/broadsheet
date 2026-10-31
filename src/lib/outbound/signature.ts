/**
 * @packageDocumentation
 *
 * Signing webhook deliveries. The receiver gets `Webhook-Timestamp` (seconds
 * since the epoch) and `Webhook-Signature: sha256=<hex>`, the HMAC-SHA256 of
 * `<timestamp>.<body>` under the hook's secret, so it can tell the delivery is
 * ours and recent.
 */

import { hex } from './tokens';

/** The headers that sign one delivery of `body` at `timestamp`. */
export async function signatureHeaders(
  secret: string,
  body: string,
  timestamp: number,
): Promise<Record<string, string>> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  return {
    'Webhook-Timestamp': String(timestamp),
    'Webhook-Signature': `sha256=${hex(mac)}`,
  };
}
