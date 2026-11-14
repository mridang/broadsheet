import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import { databaseFrom, type Database } from '@/domain/db/client';
import { Repository } from '@/domain/repository';
import {
  callbackUrl,
  needsSubscription,
  subscribeToHub,
  verifyIntent,
} from '@/domain/websub';
import { APP_MIGRATIONS } from '../lib/core/db/migrations';
import { sqliteD1 } from '../lib/core/db/sqlite-d1';

const LINKS = { hub: 'https://hub.test/', self: 'https://a.test/f' };
const NOW = Date.parse('2026-11-01T00:00:00Z');

let db: Database;
let sourceId: number;

const source = async () => (await new Repository(db).sourceById(sourceId))!;

beforeEach(async () => {
  db = databaseFrom(sqliteD1(...APP_MIGRATIONS).d1);
  sourceId = (await new Repository(db).addFeed(1, 'https://a.test/f'))!
    .source_id;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('needsSubscription', () => {
  const subscribed = {
    websub_hub: LINKS.hub,
    websub_topic: LINKS.self,
    websub_expires_at: '2026-11-05 00:00:00',
  };

  it('leaves a feed with no hub alone', () => {
    expect(needsSubscription(subscribed, {}, NOW)).toBe(false);
  });

  it('leaves a verified lease with days to run', () => {
    expect(needsSubscription(subscribed, LINKS, NOW)).toBe(false);
  });

  it.each([
    [
      'never subscribed',
      { websub_hub: null, websub_topic: null, websub_expires_at: null },
    ],
    ['not verified', { ...subscribed, websub_expires_at: null }],
    [
      'nearly expired',
      { ...subscribed, websub_expires_at: '2026-11-01 12:00:00' },
    ],
    ['at another hub', { ...subscribed, websub_hub: 'https://old.test/' }],
  ])('subscribes a source %s', (_, state) => {
    expect(needsSubscription(state, LINKS, NOW)).toBe(true);
  });
});

describe('callbackUrl', () => {
  it('is the webhook of the source, outside /api', () => {
    expect(new URL(callbackUrl(42)).pathname).toBe('/webhooks/sources/42');
  });
});

describe('subscribeToHub', () => {
  it('asks the hub for the topic with the callback and a secret it keeps', async () => {
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 202 }));
    expect(await subscribeToHub(db, sourceId, LINKS)).toBe(true);
    const [url, init] = fetch.mock.calls[0]!;
    const form = init?.body as URLSearchParams;
    const stored = await source();
    expect(url).toBe(LINKS.hub);
    expect(Object.fromEntries(form)).toMatchObject({
      'hub.mode': 'subscribe',
      'hub.topic': LINKS.self,
      'hub.callback': callbackUrl(sourceId),
      'hub.secret': stored.websub_secret,
    });
    expect(stored).toMatchObject({
      websub_hub: LINKS.hub,
      websub_topic: LINKS.self,
      websub_expires_at: null,
    });
  });

  it('says when the hub refuses', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 400 }));
    expect(await subscribeToHub(db, sourceId, LINKS)).toBe(false);
  });
});

describe('verifyIntent', () => {
  const ask = (params: Record<string, string>) =>
    verifyIntent(db, sourceId, new URLSearchParams(params), NOW);

  beforeEach(async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 202 }));
    await subscribeToHub(db, sourceId, LINKS);
  });

  it('echoes the challenge of a subscription it asked for and keeps the lease', async () => {
    expect(
      await ask({
        'hub.mode': 'subscribe',
        'hub.topic': LINKS.self,
        'hub.challenge': 'abc',
        'hub.lease_seconds': '3600',
      }),
    ).toBe('abc');
    const current = await source();
    expect(current.websub_expires_at).toBe('2026-11-01 01:00:00');
  });

  it('refuses a subscription to another topic', async () => {
    expect(
      await ask({
        'hub.mode': 'subscribe',
        'hub.topic': 'https://evil.test/',
        'hub.challenge': 'abc',
      }),
    ).toBeUndefined();
  });

  it('refuses to unsubscribe from the topic it follows', async () => {
    expect(
      await ask({
        'hub.mode': 'unsubscribe',
        'hub.topic': LINKS.self,
        'hub.challenge': 'abc',
      }),
    ).toBeUndefined();
  });

  it('confirms unsubscribing from a topic it no longer follows', async () => {
    expect(
      await ask({
        'hub.mode': 'unsubscribe',
        'hub.topic': 'https://old.test/f',
        'hub.challenge': 'abc',
      }),
    ).toBe('abc');
  });

  it('forgets a subscription the hub denies', async () => {
    await ask({ 'hub.mode': 'denied', 'hub.topic': LINKS.self });
    const current = await source();
    expect(current.websub_hub).toBeNull();
  });

  it('refuses a source that does not exist', async () => {
    expect(
      await verifyIntent(
        db,
        999,
        new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.challenge': 'x' }),
      ),
    ).toBeUndefined();
  });
});
