/**
 * @packageDocumentation
 *
 * Types shared across the Web Push library: the subscription shape sent
 * by the browser and the per-message envelope.
 */

/** Subscription record as stored in D1. @public */
export interface PushSubscriptionRecord {
  readonly endpoint: string;
  readonly p256dh: string;
  readonly auth: string;
}

/** JSON payload the client service worker receives. @public */
export interface PushPayload {
  readonly title: string;
  readonly body: string;
  readonly image?: string;
  readonly tag?: string;
  readonly url?: string;
}

/** Outcome of one delivery attempt. @public */
export interface DeliveryResult {
  readonly endpoint: string;
  readonly status: number;
  /**
   * `true` when the push endpoint signalled the subscription is gone
   * (HTTP 404/410) and we should drop it from D1.
   */
  readonly gone: boolean;
}

/**
 * Storage the push library needs but does not own: the set of registered
 * subscriptions. The app implements this port (over D1, a test fake, etc.); the
 * library stays free of any database. @public
 */
export interface PushSubscriptionStore {
  /** Read every active subscription. */
  listAll(): Promise<readonly PushSubscriptionRecord[]>;
  /** Insert or replace a subscription keyed by `endpoint`. */
  upsert(record: PushSubscriptionRecord, nowIso: string): Promise<void>;
  /** Drop the subscription keyed by `endpoint`. Idempotent. */
  remove(endpoint: string): Promise<void>;
  /** Stamp the most-recent send time for a subscription. */
  markSent(endpoint: string, nowIso: string): Promise<void>;
}
