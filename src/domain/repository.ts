/**
 * @packageDocumentation
 *
 * Data access over Drizzle/D1: users, feeds, and articles. Every query the
 * app and scrape pipeline need, in one place.
 */
import { and, asc, desc, eq, sql } from 'drizzle-orm';

import { type Database } from '@/core/db/client';
import { articles, feeds, users } from '@/domain/db/schema';
import type { ScrapedItem } from '@/lib/scraping/types';

/** A signed-in person. */
export type User = typeof users.$inferSelect;
/** A feed a user follows. */
export type Feed = typeof feeds.$inferSelect;
/** An article scraped from a feed. */
export type Article = typeof articles.$inferSelect;

/** What is known about a person from their Google account. */
export interface Profile {
  /** Google's stable id for the account. */
  readonly sub: string;
  readonly email: string;
  readonly name?: string;
  readonly picture?: string;
}

/**
 * Find the person by their Google account id, creating them the first time and
 * refreshing their email, name and picture on return. Their session epoch is
 * left alone.
 */
export async function upsertUser(db: Database, p: Profile): Promise<User> {
  const profile = {
    email: p.email,
    name: p.name ?? null,
    picture: p.picture ?? null,
  };
  const rows = await db
    .insert(users)
    .values({ google_sub: p.sub, ...profile })
    .onConflictDoUpdate({ target: users.google_sub, set: profile })
    .returning();
  return rows[0]!;
}

export function getUser(db: Database, id: number): Promise<User | undefined> {
  return db.query.users.findFirst({ where: eq(users.id, id) });
}

/**
 * The epoch the person's sessions must carry to be honoured, or undefined when
 * the account no longer exists.
 */
export async function getSessionEpoch(
  db: Database,
  id: number,
): Promise<number | undefined> {
  const [row] = await db
    .select({ epoch: users.session_epoch })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  return row?.epoch;
}

/**
 * End every session the person has, on every device, by moving to the next
 * epoch: cookies issued under the old one stop being honoured at once.
 */
export async function bumpSessionEpoch(
  db: Database,
  id: number,
): Promise<void> {
  await db
    .update(users)
    .set({ session_epoch: sql`${users.session_epoch} + 1` })
    .where(eq(users.id, id));
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

/** The person's feed at `url`, or undefined when they do not follow it. */
export function getFeedByUrl(
  db: Database,
  userId: number,
  url: string,
): Promise<Feed | undefined> {
  return db.query.feeds.findFirst({
    where: and(eq(feeds.user_id, userId), eq(feeds.url, url)),
  });
}

/** Stop following a feed. True when there was one to remove. */
export async function removeFeed(
  db: Database,
  userId: number,
  id: number,
): Promise<boolean> {
  const removed = await db
    .delete(feeds)
    .where(and(eq(feeds.id, id), eq(feeds.user_id, userId)))
    .returning({ id: feeds.id });
  return removed.length > 0;
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
        points: a.points || 0,
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

/** Distinct edition dates that already exist for a single feed. */
export async function editionsForFeed(
  db: Database,
  feedId: number,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ edition: articles.edition })
    .from(articles)
    .where(eq(articles.feed_id, feedId));
  return rows.map((r) => r.edition).filter((e): e is string => !!e);
}
