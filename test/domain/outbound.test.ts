import { beforeEach, describe, expect, it } from '@jest/globals';

import { databaseFrom, type Database } from '@/domain/db/database';
import { OutboundRepository } from '@/domain/outbound';
import { Repository } from '@/domain/repository';
import type { ScrapedItem } from '@/lib/scraping';
import { APP_MIGRATIONS } from '../lib/core/db/migrations';
import { sqliteD1 } from '../lib/core/db/sqlite-d1';

let db: Database;
let repo: OutboundRepository;

beforeEach(() => {
  db = databaseFrom(sqliteD1(...APP_MIGRATIONS).d1);
  repo = new OutboundRepository(db);
});

/** A scraped story with only what a case cares about. */
const story = (over: Partial<ScrapedItem>): ScrapedItem => ({
  url: 'https://x/1',
  title: 'T',
  source: '',
  favicon: '',
  summary: '',
  image: '',
  published_at: '',
  points: 0,
  ...over,
});

const browser = { endpoint: 'https://push.test/a', p256dh: 'k', auth: 'a' };

describe('push subscriptions', () => {
  it('adds a browser, then moves a known endpoint to whoever posts it', async () => {
    const first = await repo.addPushSubscription(1, browser);
    expect(first.created).toBe(true);
    const again = await repo.addPushSubscription(2, { ...browser, auth: 'b' });
    expect(again).toMatchObject({
      created: false,
      subscription: { id: first.subscription.id, user_id: 2, auth: 'b' },
    });
    expect(await repo.pushSubscriptions(1)).toEqual([]);
  });

  it('removes only the person’s own, and forgets a gone endpoint', async () => {
    const { subscription } = await repo.addPushSubscription(1, browser);
    expect(await repo.removePushSubscription(2, subscription.id)).toBe(false);
    expect(await repo.removePushSubscription(1, subscription.id)).toBe(true);
    await repo.addPushSubscription(1, browser);
    await repo.removePushEndpoint(browser.endpoint);
    expect(await repo.pushSubscriptions(1)).toEqual([]);
  });
});

describe('webhooks', () => {
  it('keeps the events and finds the hooks that want one', async () => {
    const save = await repo.addWebhook(1, 'https://h.test/1', ['save'], 's');
    await repo.addWebhook(1, 'https://h.test/2', ['like'], 's');
    expect(save.events).toEqual(['save']);
    expect((await repo.webhooksFor(1, 'save')).map((h) => h.url)).toEqual([
      'https://h.test/1',
    ]);
    expect(await repo.webhooksFor(2, 'save')).toEqual([]);
  });

  it('removes only the person’s own', async () => {
    const hook = await repo.addWebhook(1, 'https://h.test/1', ['save'], 's');
    expect(await repo.removeWebhook(2, hook.id)).toBe(false);
    expect(await repo.removeWebhook(1, hook.id)).toBe(true);
    expect(await repo.listWebhooks(1)).toEqual([]);
  });
});

describe('feed tokens', () => {
  it('finds a token by its hash and revokes only the person’s own', async () => {
    const token = await repo.addFeedToken(1, 'h1', {
      scope: 'saves',
      tag: 'x',
    });
    expect(await repo.feedTokenByHash('h1')).toMatchObject({
      id: token.id,
      scope: 'saves',
      tag: 'x',
      section_id: null,
    });
    expect(await repo.feedTokenByHash('h2')).toBeUndefined();
    expect(await repo.removeFeedToken(2, token.id)).toBe(false);
    expect(await repo.removeFeedToken(1, token.id)).toBe(true);
    expect(await repo.listFeedTokens(1)).toEqual([]);
  });
});

describe('editionStories', () => {
  it('lists the newest edition of unmuted feeds, best first, optionally one section', async () => {
    const main = new Repository(db);
    const section = await main.addSection(1, 'Tech');
    const a = (await main.addFeed(1, 'https://a.test/f'))!;
    const b = (await main.addFeed(1, 'https://b.test/f'))!;
    const muted = (await main.addFeed(1, 'https://c.test/f'))!;
    await main.updateFeed(1, a.id, { section_id: section.id });
    await main.updateFeed(1, muted.id, { muted: true });
    await main.writeEdition(a.source_id, '2026-10-01', [
      story({ url: 'https://x/old' }),
    ]);
    await main.writeEdition(a.source_id, '2026-10-02', [
      story({ url: 'https://x/a', points: 5 }),
    ]);
    await main.writeEdition(b.source_id, '2026-10-02', [
      story({ url: 'https://x/b', points: 9 }),
    ]);
    await main.writeEdition(muted.source_id, '2026-10-02', [
      story({ url: 'https://x/m', points: 99 }),
    ]);
    expect((await repo.editionStories(1)).map((s) => s.url)).toEqual([
      'https://x/b',
      'https://x/a',
    ]);
    expect(
      (await repo.editionStories(1, section.id)).map((s) => s.url),
    ).toEqual(['https://x/a']);
    expect(await repo.editionStories(2)).toEqual([]);
  });
});
