/**
 * @packageDocumentation
 *
 * The list -> send -> prune -> mark orchestration for Web Push, over a
 * {@link WebPushSender} and a {@link PushSubscriptionStore} port. It owns the
 * rule that a 404/410 means the subscription is gone (drop it) and a 2xx means
 * delivered (stamp it). A caller that needs per-subscription durability (a
 * Workflow checkpointing each send) drives {@link PushNotifier.deliver}
 * itself; {@link PushNotifier.broadcast} is the convenience that sends to all.
 */

import { WebPushSender } from './send';
import type {
  PushPayload,
  PushSubscriptionRecord,
  PushSubscriptionStore,
} from './types';

/** What delivering to one subscription came to. @public */
export interface DeliveryOutcome {
  /** True when the push service accepted it (2xx). */
  readonly delivered: boolean;
  /** True when the subscription was gone (404/410) and was removed. */
  readonly pruned: boolean;
}

/** What a broadcast came to. @public */
export interface BroadcastResult {
  /** How many subscriptions accepted the push. */
  readonly sent: number;
  /** How many gone subscriptions were dropped. */
  readonly pruned: number;
}

/** Sends to subscriptions and keeps the store honest about which still exist. @public */
export class PushNotifier {
  public constructor(
    private readonly sender: WebPushSender,
    private readonly store: PushSubscriptionStore,
  ) {}

  /** Send to one subscription: drop it on Gone, stamp it on success. */
  public async deliver(
    subscription: PushSubscriptionRecord,
    payload: PushPayload,
  ): Promise<DeliveryOutcome> {
    const result = await this.sender.send(subscription, payload);
    if (result.gone) {
      await this.store.remove(subscription.endpoint);
      return { delivered: false, pruned: true };
    }
    const delivered = result.status >= 200 && result.status < 300;
    if (delivered) {
      await this.store.markSent(
        subscription.endpoint,
        new Date().toISOString(),
      );
    }
    return { delivered, pruned: false };
  }

  /** Send `payload` to every stored subscription. */
  public async broadcast(payload: PushPayload): Promise<BroadcastResult> {
    const subscriptions = await this.store.listAll();
    return subscriptions.reduce<Promise<BroadcastResult>>(
      async (accP, subscription) => {
        const acc = await accP;
        const { delivered, pruned } = await this.deliver(subscription, payload);
        return {
          sent: acc.sent + (delivered ? 1 : 0),
          pruned: acc.pruned + (pruned ? 1 : 0),
        };
      },
      Promise.resolve({ sent: 0, pruned: 0 }),
    );
  }
}
