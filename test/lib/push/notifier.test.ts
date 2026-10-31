import { describe, expect, it } from '@jest/globals';

import {
  PushNotifier,
  type DeliveryResult,
  type PushPayload,
  type PushSubscriptionRecord,
  type PushSubscriptionStore,
  type WebPushSender,
} from '@/lib/push';

const PAYLOAD: PushPayload = { title: 't', body: 'b' };

function record(endpoint: string): PushSubscriptionRecord {
  return { endpoint, p256dh: 'p', auth: 'a' };
}

/** A store that records what the notifier did to it. */
class FakeStore implements PushSubscriptionStore {
  public readonly removed: string[] = [];
  public readonly marked: string[] = [];
  public constructor(private readonly records: PushSubscriptionRecord[]) {}
  public listAll(): Promise<readonly PushSubscriptionRecord[]> {
    return Promise.resolve(this.records);
  }
  public upsert(): Promise<void> {
    return Promise.resolve();
  }
  public remove(endpoint: string): Promise<void> {
    this.removed.push(endpoint);
    return Promise.resolve();
  }
  public markSent(endpoint: string): Promise<void> {
    this.marked.push(endpoint);
    return Promise.resolve();
  }
}

/** A sender that answers each endpoint with a fixed HTTP status. */
function senderReturning(
  statusByEndpoint: Readonly<Record<string, number>>,
): WebPushSender {
  return {
    send: (subscription: PushSubscriptionRecord): Promise<DeliveryResult> => {
      const status = statusByEndpoint[subscription.endpoint] ?? 201;
      return Promise.resolve({
        endpoint: subscription.endpoint,
        status,
        gone: status === 404 || status === 410,
      });
    },
  } as unknown as WebPushSender;
}

describe('PushNotifier.deliver', () => {
  it('stamps a subscription that the push service accepted', async () => {
    const store = new FakeStore([record('https://push.test/a')]);
    const notifier = new PushNotifier(
      senderReturning({ 'https://push.test/a': 201 }),
      store,
    );
    const outcome = await notifier.deliver(
      record('https://push.test/a'),
      PAYLOAD,
    );
    expect(outcome).toEqual({ delivered: true, pruned: false });
    expect(store.marked).toEqual(['https://push.test/a']);
    expect(store.removed).toEqual([]);
  });

  it('drops a subscription the push service reports as gone', async () => {
    const store = new FakeStore([record('https://push.test/gone')]);
    const notifier = new PushNotifier(
      senderReturning({ 'https://push.test/gone': 410 }),
      store,
    );
    const outcome = await notifier.deliver(
      record('https://push.test/gone'),
      PAYLOAD,
    );
    expect(outcome).toEqual({ delivered: false, pruned: true });
    expect(store.removed).toEqual(['https://push.test/gone']);
    expect(store.marked).toEqual([]);
  });

  it('neither stamps nor drops on a retryable failure', async () => {
    const store = new FakeStore([record('https://push.test/503')]);
    const notifier = new PushNotifier(
      senderReturning({ 'https://push.test/503': 503 }),
      store,
    );
    const outcome = await notifier.deliver(
      record('https://push.test/503'),
      PAYLOAD,
    );
    expect(outcome).toEqual({ delivered: false, pruned: false });
    expect(store.removed).toEqual([]);
    expect(store.marked).toEqual([]);
  });
});

describe('PushNotifier.broadcast', () => {
  it('tallies the sent and the pruned across every stored subscription', async () => {
    const store = new FakeStore([
      record('https://push.test/ok'),
      record('https://push.test/gone'),
      record('https://push.test/err'),
    ]);
    const notifier = new PushNotifier(
      senderReturning({
        'https://push.test/ok': 201,
        'https://push.test/gone': 404,
        'https://push.test/err': 500,
      }),
      store,
    );
    const result = await notifier.broadcast(PAYLOAD);
    expect(result).toEqual({ sent: 1, pruned: 1 });
    expect(store.marked).toEqual(['https://push.test/ok']);
    expect(store.removed).toEqual(['https://push.test/gone']);
  });
});
