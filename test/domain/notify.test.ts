import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { databaseFrom, type Database } from '@/domain/db/database';
import { NotificationRepository } from '@/domain/notifications';
import {
  deliverWebhooks,
  notifies,
  notifyNewStories,
  sendIssueReady,
  stillActive,
  STORIES_PER_FEED,
} from '@/domain/notify';
import { Repository } from '@/domain/repository';
import type { ScrapedItem } from '@/lib/scraping';
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
      VAPID_SUBJECT: 'mailto:test@broadsheet.test',
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

describe('notifies', () => {
  it.each([
    ['unread', -1, false],
    ['unread', 0, true],
    ['unread', 1, true],
    ['focus', 0, false],
    ['focus', 1, true],
  ] as const)(
    'under %s, a story scored %d notifies: %s',
    (filter, score, yes) => {
      expect(notifies(filter, score)).toBe(yes);
    },
  );
});

const story = (url: string, title: string): ScrapedItem => ({
  url,
  title,
  source: '',
  favicon: '',
  summary: 'S',
  image: '',
  published_at: '',
  points: 0,
});

/** A mail binding that records what it was asked to send. */
function mailbox(fails = false) {
  const sent: Record<string, unknown>[] = [];
  return {
    sent,
    EMAIL: {
      send: async (message: Record<string, unknown>) => {
        if (fails) throw new Error('refused');
        sent.push(message);
        return { messageId: 'm' };
      },
    } as unknown as SendEmail,
    EMAIL_FROM: 'paper@broadsheet.test',
  };
}

/** Person 1 follows one feed with these stories today, notifying by `channels`. */
async function notifying(
  channels: ('web' | 'email' | 'webhook')[],
  filter: 'unread' | 'focus' = 'unread',
  titles: readonly string[] = ['One', 'Two'],
) {
  const repo = new Repository(db);
  const user = await repo.upsertUser({ sub: 'g', email: 'me@b.co' });
  const feed = (await repo.addFeed(user.id, 'https://a.test/f', 'Feed'))!;
  await repo.writeEdition(
    feed.source_id,
    '2026-10-02',
    titles.map((t, i) => story(`https://x/${i}`, t)),
  );
  await new NotificationRepository(db).setFeedNotification(user.id, feed.id, {
    filter,
    channels,
  });
  return { user, feed };
}

describe('notifyNewStories', () => {
  it('tells nobody who has no notifying feeds', async () => {
    const { fetcher, calls } = answering();
    expect(await notifyNewStories({}, db, 1, '2026-10-02', fetcher)).toEqual({
      stories: 0,
      pushed: 0,
      emailed: 0,
      hooked: 0,
    });
    expect(calls).toEqual([]);
  });

  it('pushes each new story once, even when the run is repeated', async () => {
    const { env, p256dh, auth } = await keys();
    const { user } = await notifying(['web']);
    await new OutboundRepository(db).addPushSubscription(user.id, {
      endpoint: 'https://push.example.com/a',
      p256dh,
      auth,
    });
    const { fetcher, calls } = answering(201, 201);
    expect(
      await notifyNewStories(env, db, user.id, '2026-10-02', fetcher),
    ).toEqual({
      stories: 2,
      pushed: 2,
      emailed: 0,
      hooked: 0,
    });
    expect(calls).toHaveLength(2);
    expect(
      (await notifyNewStories(env, db, user.id, '2026-10-02', fetcher)).stories,
    ).toBe(0);
  });

  it(`stops at ${STORIES_PER_FEED} stories a feed and run`, async () => {
    const { user } = await notifying(['webhook'], 'unread', [
      'A',
      'B',
      'C',
      'D',
      'E',
    ]);
    expect(
      (await notifyNewStories({}, db, user.id, '2026-10-02')).stories,
    ).toBe(STORIES_PER_FEED);
  });

  it('leaves out disliked stories, and with focus keeps only liked ones', async () => {
    const { user } = await notifying(['webhook'], 'focus', [
      'Rust news',
      'Go news',
      'Ads',
    ]);
    const repo = new Repository(db);
    await repo.addClassifier(user.id, {
      kind: 'title',
      value: 'rust',
      score: 1,
    });
    expect(
      (await notifyNewStories({}, db, user.id, '2026-10-02')).stories,
    ).toBe(1);
  });

  it('emails the person their story under the feed’s name', async () => {
    const { user } = await notifying(['email'], 'unread', ['One']);
    const mail = mailbox();
    expect(
      (await notifyNewStories(mail, db, user.id, '2026-10-02')).emailed,
    ).toBe(1);
    expect(mail.sent[0]).toMatchObject({ to: 'me@b.co', subject: 'Feed: One' });
    expect(await new NotificationRepository(db).emailsToday(user.id)).toBe(1);
  });

  it('sends no email when email is not set up', async () => {
    const { user } = await notifying(['email'], 'unread', ['One']);
    const result = await notifyNewStories({}, db, user.id, '2026-10-02');
    expect(result).toMatchObject({ stories: 1, emailed: 0 });
  });

  it('counts no email the mail service refused', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { user } = await notifying(['email'], 'unread', ['One']);
    const result = await notifyNewStories(
      mailbox(true),
      db,
      user.id,
      '2026-10-02',
    );
    expect(result).toMatchObject({ stories: 1, emailed: 0 });
    expect(await new NotificationRepository(db).emailsToday(user.id)).toBe(0);
  });

  it('stops emailing once the daily cap is reached', async () => {
    const { user } = await notifying(['email'], 'unread', ['One']);
    const counts = new NotificationRepository(db);
    for (let id = 1000; id < 1025; id++) {
      await counts.claimDelivery(user.id, id);
      await counts.markEmailed(user.id, id);
    }
    const mail = mailbox();
    expect(
      (await notifyNewStories(mail, db, user.id, '2026-10-02')).emailed,
    ).toBe(0);
    expect(mail.sent).toEqual([]);
  });

  it('sends a webhook story event naming the feed and story', async () => {
    const { user, feed } = await notifying(['webhook'], 'unread', ['One']);
    await new OutboundRepository(db).addWebhook(
      user.id,
      'https://hooks.example.com/s',
      ['story'],
      's',
    );
    const { fetcher, calls } = answering(204);
    expect(
      (await notifyNewStories({}, db, user.id, '2026-10-02', fetcher)).hooked,
    ).toBe(1);
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      event: 'story',
      data: {
        feed_id: String(feed.id),
        feed_title: 'Feed',
        title: 'One',
        url: 'https://x/0',
      },
    });
  });
});

describe('stillActive', () => {
  it.each([
    [undefined, true],
    ['2026-07-04', true],
    ['2026-07-03', false],
  ])('last seen %s is active on 2026-10-02: %s', (seen, yes) => {
    expect(stillActive(seen, '2026-10-02')).toBe(yes);
  });
});

describe('notifyNewStories rules and activity', () => {
  /** Person 1 follows one feed with these stories today and no feed notifications. */
  async function following(titles: readonly string[]) {
    const repo = new Repository(db);
    const user = await repo.upsertUser({ sub: 'g', email: 'me@b.co' });
    const feed = (await repo.addFeed(user.id, 'https://a.test/f', 'Feed'))!;
    await repo.writeEdition(
      feed.source_id,
      '2026-10-02',
      titles.map((t, i) => story(`https://x/${i}`, t)),
    );
    return { user, feed };
  }

  it('notifies about stories a rule matches, at most three a rule', async () => {
    const { user } = await following([
      'Rust 1',
      'Rust 2',
      'Rust 3',
      'Rust 4',
      'Go',
    ]);
    await new NotificationRepository(db).addRule(user.id, {
      kind: 'title',
      value: 'rust',
      is_regex: false,
      scope: 'all',
      channels: ['webhook'],
    });
    expect(
      (await notifyNewStories({}, db, user.id, '2026-10-02')).stories,
    ).toBe(STORIES_PER_FEED);
  });

  it('tells about a story once when a feed and a rule both find it', async () => {
    const { user } = await notifying(['webhook'], 'unread', ['Rust']);
    await new NotificationRepository(db).addRule(user.id, {
      kind: 'title',
      value: 'rust',
      is_regex: false,
      scope: 'all',
      channels: ['webhook'],
    });
    expect(
      (await notifyNewStories({}, db, user.id, '2026-10-02')).stories,
    ).toBe(1);
  });

  it('tells nobody who has been away for more than 90 days', async () => {
    const { user } = await notifying(['webhook'], 'unread', ['One']);
    await new NotificationRepository(db).noteSeen(user.id, '2026-06-01');
    expect(
      (await notifyNewStories({}, db, user.id, '2026-10-02')).stories,
    ).toBe(0);
  });
});
