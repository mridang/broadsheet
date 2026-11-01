import { beforeEach, describe, expect, it } from '@jest/globals';

import { databaseFrom, type Database } from '@/domain/db/database';
import { NotificationRepository } from '@/domain/notifications';
import { Repository } from '@/domain/repository';
import type { ScrapedItem } from '@/lib/scraping';
import { APP_MIGRATIONS } from '../lib/core/db/migrations';
import { sqliteD1 } from '../lib/core/db/sqlite-d1';

let db: Database;
let raw: ReturnType<typeof sqliteD1>['raw'];
let repo: NotificationRepository;

beforeEach(() => {
  const made = sqliteD1(...APP_MIGRATIONS);
  raw = made.raw;
  db = databaseFrom(made.d1);
  repo = new NotificationRepository(db);
});

const story = (url: string): ScrapedItem => ({
  url,
  title: url,
  source: '',
  favicon: '',
  summary: '',
  image: '',
  published_at: '',
  points: 0,
});

describe('setFeedNotification and feedNotifications', () => {
  it('sets one of the person’s feeds, then replaces it', async () => {
    const feed = (await new Repository(db).addFeed(
      1,
      'https://a.test/f',
      'A',
    ))!;
    expect(
      await repo.setFeedNotification(1, feed.id, {
        filter: 'unread',
        channels: ['web'],
      }),
    ).toEqual({ created: true });
    expect(
      await repo.setFeedNotification(1, feed.id, {
        filter: 'focus',
        channels: ['email', 'webhook'],
      }),
    ).toEqual({ created: false });
    expect(await repo.feedNotifications(1)).toEqual([
      {
        feed_id: feed.id,
        source_id: feed.source_id,
        feed_title: 'A',
        filter: 'focus',
        channels: ['email', 'webhook'],
      },
    ]);
    expect(await repo.notifiedUserIds()).toEqual([1]);
  });

  it('refuses a feed that is not the person’s', async () => {
    const feed = (await new Repository(db).addFeed(2, 'https://a.test/f'))!;
    expect(
      await repo.setFeedNotification(1, feed.id, {
        filter: 'unread',
        channels: ['web'],
      }),
    ).toBeUndefined();
  });

  it('leaves out muted and unfollowed feeds', async () => {
    const main = new Repository(db);
    const muted = (await main.addFeed(1, 'https://a.test/f'))!;
    const gone = (await main.addFeed(1, 'https://b.test/f'))!;
    for (const f of [muted, gone]) {
      await repo.setFeedNotification(1, f.id, {
        filter: 'unread',
        channels: ['web'],
      });
    }
    await main.updateFeed(1, muted.id, { muted: true });
    await main.removeFeed(1, gone.id);
    expect(await repo.feedNotifications(1)).toEqual([]);
  });

  it('notifies again once a timed mute has run out', async () => {
    const main = new Repository(db);
    const feed = (await main.addFeed(1, 'https://a.test/f'))!;
    await repo.setFeedNotification(1, feed.id, {
      filter: 'unread',
      channels: ['web'],
    });
    await main.updateFeed(1, feed.id, {
      muted: true,
      muted_until: '2000-01-01 00:00:00',
    });
    expect(await repo.feedNotifications(1)).toHaveLength(1);
  });

  it('removes a setting once, then says there was none', async () => {
    const feed = (await new Repository(db).addFeed(1, 'https://a.test/f'))!;
    await repo.setFeedNotification(1, feed.id, {
      filter: 'unread',
      channels: ['web'],
    });
    expect(await repo.removeFeedNotification(1, feed.id)).toBe(true);
    expect(await repo.removeFeedNotification(1, feed.id)).toBe(false);
  });
});

describe('undeliveredStories and claimDelivery', () => {
  it('lists the edition’s stories until each is claimed, and claims once', async () => {
    const main = new Repository(db);
    const feed = (await main.addFeed(1, 'https://a.test/f'))!;
    await main.writeEdition(feed.source_id, '2026-10-02', [
      story('https://x/1'),
      story('https://x/2'),
    ]);
    const [first, second] = await repo.undeliveredStories(
      1,
      feed.source_id,
      '2026-10-02',
    );
    expect(await repo.claimDelivery(1, first!.id)).toBe(true);
    expect(await repo.claimDelivery(1, first!.id)).toBe(false);
    expect(
      (await repo.undeliveredStories(1, feed.source_id, '2026-10-02')).map(
        (s) => s.id,
      ),
    ).toEqual([second!.id]);
    expect(
      await repo.undeliveredStories(2, feed.source_id, '2026-10-02'),
    ).toHaveLength(2);
  });
});

describe('the daily counts', () => {
  it('counts the emailed notifications of the last day only', async () => {
    await repo.claimDelivery(1, 10);
    await repo.claimDelivery(1, 11);
    await repo.markEmailed(1, 10);
    await repo.markEmailed(1, 11);
    raw.exec(
      "UPDATE notification_deliveries SET created_at = datetime('now', '-2 days') WHERE article_id = 11",
    );
    expect(await repo.emailsToday(1)).toBe(1);
    expect(await repo.emailsToday(2)).toBe(0);
  });

  it('counts the stories the person emailed in the last day', async () => {
    await repo.recordStoryEmail(1, 5, 3);
    await repo.recordStoryEmail(1, 6, 1);
    raw.exec(
      "UPDATE story_emails SET created_at = datetime('now', '-2 days') WHERE article_id = 6",
    );
    expect(await repo.storyEmailsToday(1)).toBe(1);
  });
});

describe('rules', () => {
  it('adds a rule for every feed, lists and removes it', async () => {
    const rule = await repo.addRule(1, {
      kind: 'title',
      value: 'rust',
      is_regex: false,
      scope: 'all',
      channels: ['web'],
    });
    expect(rule).toMatchObject({
      kind: 'title',
      value: 'rust',
      scope: 'all',
      channels: ['web'],
    });
    expect(await repo.rules(1)).toHaveLength(1);
    expect(await repo.ruleUserIds()).toEqual([1]);
    expect(await repo.removeRule(2, rule!.id)).toBe(false);
    expect(await repo.removeRule(1, rule!.id)).toBe(true);
  });

  it('refuses a feed or section that is not the person’s', async () => {
    const main = new Repository(db);
    const feed = (await main.addFeed(2, 'https://a.test/f'))!;
    const section = await main.addSection(2, 'Tech');
    const base = {
      kind: 'title',
      value: 'x',
      is_regex: false,
      channels: ['web'],
    } as const;
    expect(
      await repo.addRule(1, { ...base, scope: 'feed', feed_id: feed.id }),
    ).toBeUndefined();
    expect(
      await repo.addRule(1, {
        ...base,
        scope: 'section',
        section_id: section.id,
      }),
    ).toBeUndefined();
    expect(
      await repo.addRule(2, { ...base, scope: 'feed', feed_id: feed.id }),
    ).toMatchObject({
      feed_id: feed.id,
      is_regex: false,
    });
  });
});

describe('undeliveredFollowedStories', () => {
  it('lists today’s undelivered stories from unmuted feeds with their feed and section', async () => {
    const main = new Repository(db);
    const section = await main.addSection(1, 'Tech');
    const a = (await main.addFeed(1, 'https://a.test/f', 'A'))!;
    const muted = (await main.addFeed(1, 'https://b.test/f'))!;
    await main.updateFeed(1, a.id, { section_id: section.id });
    await main.updateFeed(1, muted.id, { muted: true });
    await main.writeEdition(a.source_id, '2026-10-02', [
      story('https://x/1'),
      story('https://x/2'),
    ]);
    await main.writeEdition(muted.source_id, '2026-10-02', [
      story('https://x/m'),
    ]);
    const all = await repo.undeliveredFollowedStories(1, '2026-10-02');
    expect(
      all.map((s) => [s.url, s.feed_id, s.section_id, s.feed_title]),
    ).toEqual([
      ['https://x/2', a.id, section.id, 'A'],
      ['https://x/1', a.id, section.id, 'A'],
    ]);
    await repo.claimDelivery(1, all[0]!.id);
    expect(await repo.undeliveredFollowedStories(1, '2026-10-02')).toHaveLength(
      1,
    );
  });
});

describe('noteSeen and lastSeen', () => {
  it('keeps the latest day, and nothing before it was noted', async () => {
    expect(await repo.lastSeen(1)).toBeUndefined();
    await repo.noteSeen(1, '2026-10-01');
    await repo.noteSeen(1, '2026-10-02');
    expect(await repo.lastSeen(1)).toBe('2026-10-02');
  });
});
