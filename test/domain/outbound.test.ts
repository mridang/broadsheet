import { beforeEach, describe, expect, it } from '@jest/globals';

import { databaseFrom, type Database } from '@/domain/db/client';
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
    const hooks = await repo.webhooksFor(1, 'save');
    expect(hooks.map((h) => h.url)).toEqual(['https://h.test/1']);
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
    const newest = await repo.editionStories(1);
    expect(newest.map((s) => s.url)).toEqual(['https://x/b', 'https://x/a']);
    const sectionOnly = await repo.editionStories(1, section.id);
    expect(sectionOnly.map((s) => s.url)).toEqual(['https://x/a']);
    expect(await repo.editionStories(2)).toEqual([]);
  });

  it('takes in the sections nested in a section, and feeds filed there among others', async () => {
    const main = new Repository(db);
    const tech = await main.addSection(1, 'Tech');
    const ai = await main.addSection(1, 'AI', undefined, tech.id);
    const news = await main.addSection(1, 'News');
    const nested = (await main.addFeed(1, 'https://a.test/f'))!;
    const both = (await main.addFeed(1, 'https://b.test/f'))!;
    await main.updateFeed(1, nested.id, { section_id: ai.id });
    await main.updateFeed(1, both.id, { section_ids: [news.id, tech.id] });
    await main.writeEdition(nested.source_id, '2026-10-02', [
      story({ url: 'https://x/a', points: 2 }),
    ]);
    await main.writeEdition(both.source_id, '2026-10-02', [
      story({ url: 'https://x/b', points: 1 }),
    ]);
    const techOnly = await repo.editionStories(1, tech.id);
    expect(techOnly.map((s) => s.url)).toEqual(['https://x/a', 'https://x/b']);
  });

  it('lists a feed again once its timed mute has run out', async () => {
    const main = new Repository(db);
    const feed = (await main.addFeed(1, 'https://a.test/f'))!;
    await main.updateFeed(1, feed.id, {
      muted: true,
      muted_until: '2000-01-01 00:00:00',
    });
    await main.writeEdition(feed.source_id, '2026-10-02', [
      story({ url: 'https://x/a' }),
    ]);
    expect(await repo.editionStories(1)).toHaveLength(1);
  });
});

describe('bodies', () => {
  it('finds the kept text of many stories, leaving out those with none', async () => {
    const main = new Repository(db);
    const feed = (await main.addFeed(1, 'https://a.test/f'))!;
    await main.writeEdition(
      feed.source_id,
      '2026-10-02',
      Array.from({ length: 95 }, (_, i) =>
        story({
          url: `https://x/${i}`,
          ...(i ? { body_text: `Body ${i}` } : {}),
        }),
      ),
    );
    const articles = await main.sourceArticles(feed.source_id, '2026-10-02');
    const ids = articles.map((a) => a.id);
    const bodies = await repo.bodies(ids);
    expect(bodies.size).toBe(94);
    expect(await repo.bodies([])).toEqual(new Map());
  });
});

describe('feed token filters', () => {
  it('keeps the filter, and reads every token as all by default', async () => {
    const focused = await repo.addFeedToken(1, 'h1', {
      scope: 'edition',
      filter: 'focus',
    });
    expect(focused.filter).toBe('focus');
    const everything = await repo.addFeedToken(1, 'h2', { scope: 'edition' });
    expect(everything.filter).toBe('all');
  });
});
