import { beforeEach, describe, expect, it } from '@jest/globals';

import { databaseFrom, type Database } from '@/domain/db/database';
import { deliverWebhooks, sendIssueReady } from '@/domain/notify';
import { OutboundRepository } from '@/domain/outbound';
import { base64Url } from '@/lib/outbound/tokens';
import type { SafeFetcher, SafeRequestInit } from '@/lib/safe-fetch';
import { APP_MIGRATIONS } from '../lib/core/db/migrations';
import { sqliteD1 } from '../lib/core/db/sqlite-d1';

let db: Database;

beforeEach(() => {
  db = databaseFrom(sqliteD1(...APP_MIGRATIONS).d1);
});

/** A fetcher answering each call with the next status, recording what was sent. */
function answering(...statuses: number[]) {
  const calls: { url: string; init: SafeRequestInit }[] = [];
  const fetcher: SafeFetcher = async (url, init) => {
    calls.push({ url, init });
    return new Response(null, { status: statuses[calls.length - 1] ?? 201 });
  };
  return { fetcher, calls };
}

/** VAPID keys and a browser's keys, as real P-256 pairs. */
async function keys() {
  const signing = (await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign'],
  )) as CryptoKeyPair;
  const browser = (await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  )) as CryptoKeyPair;
  const raw = async (key: CryptoKey) =>
    base64Url(
      new Uint8Array(
        (await crypto.subtle.exportKey('raw', key)) as ArrayBuffer,
      ),
    );
  return {
    env: {
      VAPID_PUBLIC_KEY: await raw(signing.publicKey),
      VAPID_PRIVATE_KEY: (
        await crypto.subtle.exportKey('jwk', signing.privateKey)
      ).d!,
    },
    p256dh: await raw(browser.publicKey),
    auth: base64Url(new Uint8Array(16)),
  };
}

describe('sendIssueReady', () => {
  it('pushes to each browser, forgets the gone ones and counts the failures', async () => {
    const { env, p256dh, auth } = await keys();
    const repo = new OutboundRepository(db);
    for (const name of ['ok', 'gone', 'down']) {
      await repo.addPushSubscription(1, {
        endpoint: `https://push.example.com/${name}`,
        p256dh,
        auth,
      });
    }
    // Newest first: down, gone, ok.
    const { fetcher, calls } = answering(500, 410, 201);
    expect(await sendIssueReady(env, db, 1, '2026-10-02', fetcher)).toEqual({
      sent: 1,
      failed: 1,
      removed: 1,
    });
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.headers).toMatchObject({
      'Content-Encoding': 'aes128gcm',
    });
    expect((await repo.pushSubscriptions(1)).map((s) => s.endpoint)).toEqual([
      'https://push.example.com/down',
      'https://push.example.com/ok',
    ]);
  });

  it('sends nothing without VAPID keys', async () => {
    const { fetcher, calls } = answering();
    expect(await sendIssueReady({}, db, 1, '2026-10-02', fetcher)).toEqual({
      sent: 0,
      failed: 0,
      removed: 0,
    });
    expect(calls).toEqual([]);
  });

  it('counts a browser whose keys cannot be used as failed', async () => {
    const { env } = await keys();
    await new OutboundRepository(db).addPushSubscription(1, {
      endpoint: 'https://push.example.com/x',
      p256dh: 'not base64!',
      auth: 'x',
    });
    const { fetcher, calls } = answering();
    expect(
      await sendIssueReady(env, db, 1, '2026-10-02', fetcher),
    ).toMatchObject({ failed: 1 });
    expect(calls).toEqual([]);
  });
});

describe('deliverWebhooks', () => {
  it('posts the signed event to the hooks that want it', async () => {
    const repo = new OutboundRepository(db);
    await repo.addWebhook(1, 'https://hooks.example.com/save', ['save'], 'shh');
    await repo.addWebhook(1, 'https://hooks.example.com/like', ['like'], 'shh');
    const { fetcher, calls } = answering(204);
    const at = new Date('2026-10-02T08:00:00.123Z');
    expect(
      await deliverWebhooks(
        db,
        1,
        'save',
        { article_id: '7' },
        fetcher,
        () => at,
      ),
    ).toBe(1);
    expect(calls.map((c) => c.url)).toEqual(['https://hooks.example.com/save']);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      event: 'save',
      occurred_at: '2026-10-02T08:00:00Z',
      data: { article_id: '7' },
    });
    expect(calls[0]?.init.headers).toMatchObject({
      'Content-Type': 'application/json',
      'Webhook-Timestamp': String(Math.floor(at.getTime() / 1000)),
      'Webhook-Signature': expect.stringMatching(/^sha256=[0-9a-f]{64}$/),
    });
    expect(calls[0]?.init.redirect).toBe('manual');
  });

  it('does not count a hook that refused the delivery', async () => {
    await new OutboundRepository(db).addWebhook(
      1,
      'https://hooks.example.com/x',
      ['like'],
      's',
    );
    const { fetcher } = answering(500);
    expect(await deliverWebhooks(db, 1, 'like', {}, fetcher)).toBe(0);
  });
});
