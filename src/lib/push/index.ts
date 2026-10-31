/**
 * @packageDocumentation
 *
 * Public surface of the Web Push library: encryption, VAPID signing,
 * one-shot delivery, and the D1 subscription store. The implementation
 * is pure Web Crypto so it runs unchanged in a Cloudflare Worker.
 */

export { encryptPayload } from './encrypt';
export type { EncryptedPayload } from './encrypt';
export { signVapidAuthHeader } from './vapid';
export { WebPushSender } from './send';
export type { VapidConfig, WebPushSenderOptions } from './send';
export { PushNotifier } from './notifier';
export type { BroadcastResult, DeliveryOutcome } from './notifier';
export type {
  DeliveryResult,
  PushPayload,
  PushSubscriptionRecord,
  PushSubscriptionStore,
} from './types';
