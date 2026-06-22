/**
 * @packageDocumentation
 *
 * Data access over Drizzle/D1: users, feeds, and articles. Every query the
 * app and scrape pipeline need, in one place.
 */
import { and, asc, desc, eq } from 'drizzle-orm';

import {
  articles,
  feeds,
  users,
  type Database,
  type Feed,
  type User,
} from './db';
import type { ScrapedItem } from './scraping/types';
import type { OAuthProfile } from './auth';

export async function upsertUser(db: Database, p: OAuthProfile): Promise<User> {
  const rows = await db
    .insert(users)
    .values({ sub: p.sub, email: p.email, name: p.name, picture: p.picture })
    .onConflictDoUpdate({
      target: users.sub,
      set: { email: p.email, name: p.name, picture: p.picture },
    })
    .returning();
  return rows[0]!;
}

export function getUser(db: Database, id: number): Promise<User | undefined> {
  return db.query.users.findFirst({ where: eq(users.id, id) });
}

export function listFeeds(db: Database, userId: number): Promise<Feed[]> {
  return db
    .select()
    .from(feeds)
    .where(eq(feeds.user_id, userId))
    .orderBy(asc(feeds.created_at), asc(feeds.id));
}

export async function addFeed(
  db: Database,
  userId: number,
  url: string,
  title?: string,
): Promise<Feed | undefined> {
  await db
    .insert(feeds)
    .values({ user_id: userId, url, title: title || url })
    .onConflictDoNothing({ target: [feeds.user_id, feeds.url] });
  return db.query.feeds.findFirst({
    where: and(eq(feeds.user_id, userId), eq(feeds.url, url)),
  });
}

export async function removeFeed(
  db: Database,
  userId: number,
  id: number,
): Promise<void> {
  await db
    .delete(feeds)
    .where(and(eq(feeds.id, id), eq(feeds.user_id, userId)));
}

export function allFeeds(db: Database): Promise<Feed[]> {
  return db.select().from(feeds);
}

/** Replace a feed's article set (delete + re-insert the current items). */
export async function replaceArticles(
  db: Database,
  feedId: number,
  items: ScrapedItem[],
): Promise<void> {
  const del = db.delete(articles).where(eq(articles.feed_id, feedId));
  if (!items.length) {
    await del;
    return;
  }
  // One INSERT per row: a single multi-row insert blows past D1's ~100
  // bound-variable limit. db.batch runs them in one transaction.
  const inserts = items.map((a) =>
    db
      .insert(articles)
      .values({
        feed_id: feedId,
        url: a.url,
        title: a.title,
        source: a.source || '',
        image: a.image || '',
        favicon: a.favicon || '',
        summary: a.summary || '',
        published_at: a.published_at || '',
      })
      .onConflictDoNothing({ target: [articles.feed_id, articles.url] }),
  );
  await db.batch([del, ...inserts]);
}

export function feedArticles(db: Database, feedId: number) {
  return db
    .select()
    .from(articles)
    .where(eq(articles.feed_id, feedId))
    .orderBy(desc(articles.published_at), desc(articles.id));
}
