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

/**
 * Write one day's edition for a feed: replace just THIS edition's rows (so a
 * same-day re-run is idempotent) and insert the current items dated to
 * `edition`. Past editions are never touched — history is kept indefinitely.
 */
export async function writeEdition(
  db: Database,
  feedId: number,
  edition: string,
  items: ScrapedItem[],
): Promise<void> {
  const del = db
    .delete(articles)
    .where(and(eq(articles.feed_id, feedId), eq(articles.edition, edition)));
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
        edition,
      })
      .onConflictDoNothing({
        target: [articles.feed_id, articles.url, articles.edition],
      }),
  );
  await db.batch([del, ...inserts]);
}

export function feedArticles(db: Database, feedId: number, edition: string) {
  return db
    .select()
    .from(articles)
    .where(and(eq(articles.feed_id, feedId), eq(articles.edition, edition)))
    .orderBy(desc(articles.published_at), desc(articles.id));
}

/** Distinct edition dates available for a user's feeds, newest first. */
export async function listEditions(
  db: Database,
  userId: number,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ edition: articles.edition })
    .from(articles)
    .innerJoin(feeds, eq(articles.feed_id, feeds.id))
    .where(eq(feeds.user_id, userId))
    .orderBy(desc(articles.edition));
  return rows.map((r) => r.edition).filter((e): e is string => !!e);
}
