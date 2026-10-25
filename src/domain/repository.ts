/**
 * @packageDocumentation
 *
 * Data access over Drizzle/D1: users, feeds, and articles. Every query the
 * app and scrape pipeline need, in one place. The handle is {@link Repository},
 * built with a Drizzle client the app or the Worker hands in (see
 * `core/db/client`); it never reaches for the binding itself.
 */
import { and, asc, desc, eq, sql } from 'drizzle-orm';

import { type Database } from '@/domain/db/database';
import { articles, feeds, users } from '@/domain/db/schema';
import type { ScrapedItem } from '@/lib/scraping';

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

/** The app's data access, over an injected Drizzle client. */
export class Repository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  /**
   * Find the person by their Google account id, creating them the first time
   * and refreshing their email, name and picture on return. Their session
   * epoch is left alone.
   */
  async upsertUser(p: Profile): Promise<User> {
    const profile = {
      email: p.email,
      name: p.name ?? null,
      picture: p.picture ?? null,
    };
    const rows = await this.#db
      .insert(users)
      .values({ google_sub: p.sub, ...profile })
      .onConflictDoUpdate({ target: users.google_sub, set: profile })
      .returning();
    return rows[0]!;
  }

  getUser(id: number): Promise<User | undefined> {
    return this.#db.query.users.findFirst({ where: eq(users.id, id) });
  }

  /**
   * The epoch the person's sessions must carry to be honoured, or undefined
   * when the account no longer exists.
   */
  async getSessionEpoch(id: number): Promise<number | undefined> {
    const [row] = await this.#db
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
  async bumpSessionEpoch(id: number): Promise<void> {
    await this.#db
      .update(users)
      .set({ session_epoch: sql`${users.session_epoch} + 1` })
      .where(eq(users.id, id));
  }

  listFeeds(userId: number): Promise<Feed[]> {
    return this.#db
      .select()
      .from(feeds)
      .where(eq(feeds.user_id, userId))
      .orderBy(asc(feeds.created_at), asc(feeds.id));
  }

  async addFeed(
    userId: number,
    url: string,
    title?: string,
  ): Promise<Feed | undefined> {
    await this.#db
      .insert(feeds)
      .values({ user_id: userId, url, title: title || url })
      .onConflictDoNothing({ target: [feeds.user_id, feeds.url] });
    return this.#db.query.feeds.findFirst({
      where: and(eq(feeds.user_id, userId), eq(feeds.url, url)),
    });
  }

  /** The person's feed at `url`, or undefined when they do not follow it. */
  getFeedByUrl(userId: number, url: string): Promise<Feed | undefined> {
    return this.#db.query.feeds.findFirst({
      where: and(eq(feeds.user_id, userId), eq(feeds.url, url)),
    });
  }

  /** Stop following a feed. True when there was one to remove. */
  async removeFeed(userId: number, id: number): Promise<boolean> {
    const removed = await this.#db
      .delete(feeds)
      .where(and(eq(feeds.id, id), eq(feeds.user_id, userId)))
      .returning({ id: feeds.id });
    return removed.length > 0;
  }

  allFeeds(): Promise<Feed[]> {
    return this.#db.select().from(feeds);
  }

  /**
   * Write one day's edition for a feed: replace just THIS edition's rows (so a
   * same-day re-run is idempotent) and insert the current items dated to
   * `edition`. Past editions are never touched — history is kept indefinitely.
   */
  async writeEdition(
    feedId: number,
    edition: string,
    items: ScrapedItem[],
  ): Promise<void> {
    const del = this.#db
      .delete(articles)
      .where(and(eq(articles.feed_id, feedId), eq(articles.edition, edition)));
    if (!items.length) {
      await del;
      return;
    }
    // One INSERT per row: a single multi-row insert blows past D1's ~100
    // bound-variable limit. db.batch runs them in one transaction.
    const inserts = items.map((a) =>
      this.#db
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
    await this.#db.batch([del, ...inserts]);
  }

  feedArticles(feedId: number, edition: string) {
    return this.#db
      .select()
      .from(articles)
      .where(and(eq(articles.feed_id, feedId), eq(articles.edition, edition)))
      .orderBy(desc(articles.published_at), desc(articles.id));
  }

  /** Distinct edition dates available for a user's feeds, newest first. */
  async listEditions(userId: number): Promise<string[]> {
    const rows = await this.#db
      .selectDistinct({ edition: articles.edition })
      .from(articles)
      .innerJoin(feeds, eq(articles.feed_id, feeds.id))
      .where(eq(feeds.user_id, userId))
      .orderBy(desc(articles.edition));
    return rows.map((r) => r.edition).filter((e): e is string => !!e);
  }

  /** Distinct edition dates that already exist for a single feed. */
  async editionsForFeed(feedId: number): Promise<string[]> {
    const rows = await this.#db
      .selectDistinct({ edition: articles.edition })
      .from(articles)
      .where(eq(articles.feed_id, feedId));
    return rows.map((r) => r.edition).filter((e): e is string => !!e);
  }
}
