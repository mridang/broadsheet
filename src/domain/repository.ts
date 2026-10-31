/**
 * @packageDocumentation
 *
 * Data access over Drizzle/D1: users, sources, the subscriptions (feeds) and
 * sections people keep, and articles. Every query the
 * app and scrape pipeline need, in one place. The handle is {@link Repository},
 * built with a Drizzle client the app or the Worker hands in (see
 * `core/db/client`); it never reaches for the binding itself.
 */
import { and, asc, desc, eq, sql } from 'drizzle-orm';

import { type Database } from '@/domain/db/database';
import {
  articles,
  sections,
  sources,
  subscriptions,
  users,
} from '@/domain/db/schema';
import type { ScrapedItem } from '@/lib/scraping';

/** A signed-in person. */
export type User = typeof users.$inferSelect;
/** A feed address, fetched once for everyone who follows it. */
export type Source = typeof sources.$inferSelect;
/** A heading a person groups their feeds under. */
export type Section = typeof sections.$inferSelect;
/**
 * A feed a person follows: their subscription (whose id it carries) joined to
 * its source. `title` is their own name for it, else the source's.
 */
export interface Feed {
  readonly id: number;
  readonly user_id: number;
  readonly source_id: number;
  readonly section_id: number | null;
  readonly url: string;
  readonly title: string | null;
  readonly muted: boolean;
  readonly created_at: string | null;
}
/** The parts of a feed a person can change; null clears the title or section. */
export interface FeedChanges {
  readonly title?: string | null;
  readonly muted?: boolean;
  readonly section_id?: number | null;
}
/** The parts of a section a person can change. */
export interface SectionChanges {
  readonly name?: string;
  readonly position?: number;
}
/** An article scraped from a source. */
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

  /** The columns that make a {@link Feed}, over subscriptions joined to sources. */
  #feeds() {
    return this.#db
      .select({
        id: subscriptions.id,
        user_id: subscriptions.user_id,
        source_id: subscriptions.source_id,
        section_id: subscriptions.section_id,
        url: sources.url,
        title: sql<
          string | null
        >`coalesce(${subscriptions.title_override}, ${sources.title})`,
        muted: sql<boolean>`${subscriptions.muted} != 0`.mapWith(Boolean),
        created_at: subscriptions.created_at,
      })
      .from(subscriptions)
      .innerJoin(sources, eq(subscriptions.source_id, sources.id));
  }

  listFeeds(userId: number): Promise<Feed[]> {
    return this.#feeds()
      .where(eq(subscriptions.user_id, userId))
      .orderBy(asc(subscriptions.created_at), asc(subscriptions.id));
  }

  /** The person's feed with this id, or undefined when it is not theirs. */
  async getFeed(userId: number, id: number): Promise<Feed | undefined> {
    const [row] = await this.#feeds()
      .where(and(eq(subscriptions.id, id), eq(subscriptions.user_id, userId)))
      .limit(1);
    return row;
  }

  /**
   * Follow the feed at `url`, sharing its source with anyone else following
   * it. `title` names the source when it has no name yet.
   */
  async addFeed(
    userId: number,
    url: string,
    title?: string,
  ): Promise<Feed | undefined> {
    await this.#db
      .insert(sources)
      .values({ url, title: title || url })
      .onConflictDoNothing({ target: sources.url });
    const source = await this.#db.query.sources.findFirst({
      where: eq(sources.url, url),
    });
    if (!source) return undefined;
    await this.#db
      .insert(subscriptions)
      .values({ user_id: userId, source_id: source.id })
      .onConflictDoNothing({
        target: [subscriptions.user_id, subscriptions.source_id],
      });
    return this.getFeedByUrl(userId, url);
  }

  /** The person's feed at `url`, or undefined when they do not follow it. */
  async getFeedByUrl(userId: number, url: string): Promise<Feed | undefined> {
    const [row] = await this.#feeds()
      .where(and(eq(sources.url, url), eq(subscriptions.user_id, userId)))
      .limit(1);
    return row;
  }

  /**
   * Rename, mute or file one of the person's feeds. Undefined when it is not
   * theirs. A blank title goes back to the source's own.
   */
  async updateFeed(
    userId: number,
    id: number,
    changes: FeedChanges,
  ): Promise<Feed | undefined> {
    const set: Partial<typeof subscriptions.$inferInsert> = {};
    if (changes.title !== undefined) set.title_override = changes.title || null;
    if (changes.muted !== undefined) set.muted = changes.muted ? 1 : 0;
    if (changes.section_id !== undefined) set.section_id = changes.section_id;
    if (Object.keys(set).length) {
      await this.#db
        .update(subscriptions)
        .set(set)
        .where(
          and(eq(subscriptions.id, id), eq(subscriptions.user_id, userId)),
        );
    }
    return this.getFeed(userId, id);
  }

  /** Stop following a feed. True when there was one to remove. */
  async removeFeed(userId: number, id: number): Promise<boolean> {
    const removed = await this.#db
      .delete(subscriptions)
      .where(and(eq(subscriptions.id, id), eq(subscriptions.user_id, userId)))
      .returning({ id: subscriptions.id });
    return removed.length > 0;
  }

  /** Every source somebody follows: what the daily scrape fetches. */
  allSources(): Promise<Source[]> {
    return this.#db
      .selectDistinct({
        id: sources.id,
        url: sources.url,
        title: sources.title,
        icon: sources.icon,
        last_fetched_at: sources.last_fetched_at,
        last_error: sources.last_error,
        fail_count: sources.fail_count,
        created_at: sources.created_at,
      })
      .from(sources)
      .innerJoin(subscriptions, eq(subscriptions.source_id, sources.id));
  }

  /**
   * Note how a fetch of a source went: a success clears the error and the
   * failure count, a failure records why and counts it.
   */
  async recordFetch(sourceId: number, error?: string): Promise<void> {
    await this.#db
      .update(sources)
      .set(
        error
          ? {
              last_error: error,
              fail_count: sql`${sources.fail_count} + 1`,
            }
          : {
              last_fetched_at: sql`(datetime('now'))`,
              last_error: null,
              fail_count: 0,
            },
      )
      .where(eq(sources.id, sourceId));
  }

  /** The person's sections, in the order they go down the page. */
  listSections(userId: number): Promise<Section[]> {
    return this.#db
      .select()
      .from(sections)
      .where(eq(sections.user_id, userId))
      .orderBy(asc(sections.position), asc(sections.id));
  }

  /** The person's section with this id, or undefined when it is not theirs. */
  getSection(userId: number, id: number): Promise<Section | undefined> {
    return this.#db.query.sections.findFirst({
      where: and(eq(sections.id, id), eq(sections.user_id, userId)),
    });
  }

  /** Add a section; without a position it goes after the others. */
  async addSection(
    userId: number,
    name: string,
    position?: number,
  ): Promise<Section> {
    const at =
      position ??
      (await this.listSections(userId)).reduce(
        (last, s) => Math.max(last, s.position + 1),
        0,
      );
    const rows = await this.#db
      .insert(sections)
      .values({ user_id: userId, name, position: at })
      .returning();
    return rows[0]!;
  }

  /** Rename or move a section. Undefined when it is not the person's. */
  async updateSection(
    userId: number,
    id: number,
    changes: SectionChanges,
  ): Promise<Section | undefined> {
    if (changes.name !== undefined || changes.position !== undefined) {
      await this.#db
        .update(sections)
        .set(changes)
        .where(and(eq(sections.id, id), eq(sections.user_id, userId)));
    }
    return this.getSection(userId, id);
  }

  /**
   * Remove a section; its feeds stay, under no section. True when there was
   * one to remove.
   */
  async removeSection(userId: number, id: number): Promise<boolean> {
    const removed = await this.#db
      .delete(sections)
      .where(and(eq(sections.id, id), eq(sections.user_id, userId)))
      .returning({ id: sections.id });
    if (!removed.length) return false;
    await this.#db
      .update(subscriptions)
      .set({ section_id: null })
      .where(
        and(
          eq(subscriptions.user_id, userId),
          eq(subscriptions.section_id, id),
        ),
      );
    return true;
  }

  /**
   * Write one day's edition for a source: replace just THIS edition's rows (so a
   * same-day re-run is idempotent) and insert the current items dated to
   * `edition`. Past editions are never touched — history is kept indefinitely.
   */
  async writeEdition(
    sourceId: number,
    edition: string,
    items: ScrapedItem[],
  ): Promise<void> {
    const del = this.#db
      .delete(articles)
      .where(
        and(eq(articles.source_id, sourceId), eq(articles.edition, edition)),
      );
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
          source_id: sourceId,
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
          target: [articles.source_id, articles.url, articles.edition],
        }),
    );
    await this.#db.batch([del, ...inserts]);
  }

  sourceArticles(sourceId: number, edition: string) {
    return this.#db
      .select()
      .from(articles)
      .where(
        and(eq(articles.source_id, sourceId), eq(articles.edition, edition)),
      )
      .orderBy(desc(articles.published_at), desc(articles.id));
  }

  /** Distinct edition dates available for a user's feeds, newest first. */
  async listEditions(userId: number): Promise<string[]> {
    const rows = await this.#db
      .selectDistinct({ edition: articles.edition })
      .from(articles)
      .innerJoin(subscriptions, eq(articles.source_id, subscriptions.source_id))
      .where(eq(subscriptions.user_id, userId))
      .orderBy(desc(articles.edition));
    return rows.map((r) => r.edition).filter((e): e is string => !!e);
  }

  /** Distinct edition dates that already exist for a single source. */
  async editionsForSource(sourceId: number): Promise<string[]> {
    const rows = await this.#db
      .selectDistinct({ edition: articles.edition })
      .from(articles)
      .where(eq(articles.source_id, sourceId));
    return rows.map((r) => r.edition).filter((e): e is string => !!e);
  }
}
