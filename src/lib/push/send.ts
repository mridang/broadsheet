/**
 * @packageDocumentation
 *
 * One Web Push delivery as a constructed handle: build a {@link WebPushSender}
 * with the VAPID identity (and, optionally, a `fetcher` and TTL for tests),
 * then `send` encrypts the payload, signs the VAPID JWT, POSTs to the
 * subscription endpoint and classifies the response. No storage: the
 * list/prune/mark orchestration is {@link PushNotifier}'s job.
 */

import { bs } from './encode';
import { encryptPayload } from './encrypt';
import { signVapidAuthHeader } from './vapid';
import type {
  DeliveryResult,
  PushPayload,
  PushSubscriptionRecord,
} from './types';

/** VAPID identity configuration. @public */
export interface VapidConfig {
  /** Application server public key (uncompressed P-256, base64url). */
  readonly publicKey: string;
  /** Application server private key (`d` scalar, base64url). */
  readonly privateKey: string;
  /** `mailto:` or `https://` contact URL the push service can reach. */
  readonly subject: string;
}

/** Tunables for a {@link WebPushSender}, all optional. @public */
export interface WebPushSenderOptions {
  /** Injected fetch, so tests need no network. Defaults to `globalThis.fetch`. */
  readonly fetcher?: typeof fetch;
  /**
   * How long the push service may queue the message for an offline device.
   * One hour by default — sensible for a daily timely update, since the next
   * one supersedes a stale undelivered one anyway.
   */
  readonly ttlSeconds?: number;
}

/**
 * Sends a single Web Push notification for a fixed VAPID identity. Build once,
 * reuse per delivery. Pure codec (VAPID + RFC 8291 encryption): it owns no
 * subscriptions.
 *
 * @public
 */
export class WebPushSender {
  public constructor(
    private readonly vapid: VapidConfig,
    private readonly options: WebPushSenderOptions = {},
  ) {}

  /** Encrypt, sign and POST one notification; classify the response. */
  public async send(
    subscription: PushSubscriptionRecord,
    payload: PushPayload,
    nowSeconds: number = Math.floor(Date.now() / 1000),
  ): Promise<DeliveryResult> {
    const endpoint = subscription.endpoint;
    const audience = new URL(endpoint).origin;
    const fetcher = this.options.fetcher ?? globalThis.fetch;

    const plaintext = new TextEncoder().encode(JSON.stringify(payload));
    const encrypted = await encryptPayload({
      plaintext,
      subscriberPublicKeyB64u: subscription.p256dh,
      subscriberAuthB64u: subscription.auth,
    });

    const authorization = await signVapidAuthHeader({
      audience,
      subject: this.vapid.subject,
      publicKeyB64u: this.vapid.publicKey,
      privateKeyB64u: this.vapid.privateKey,
      nowSeconds,
    });

    const response = await fetcher(endpoint, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(this.options.ttlSeconds ?? 3600),
        Urgency: 'normal',
      },
      body: bs(encrypted.body),
    });

    return {
      endpoint,
      status: response.status,
      gone: response.status === 404 || response.status === 410,
    };
  }
}
