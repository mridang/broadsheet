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
