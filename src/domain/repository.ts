/**
 * @packageDocumentation
 *
 * Data access over Drizzle/D1: users, sources, the subscriptions (feeds) and
 * sections people keep, articles, and what people do with them (training,
 * saving and reading). Every query the
 * app and scrape pipeline need, in one place. The handle is {@link Repository},
 * built with a Drizzle client the app or the Worker hands in (see
 * `core/db/client`); it never reaches for the binding itself.
 */
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gt,
  inArray,
  isNull,
  lt,
  ne,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';

import { type Database } from '@/domain/db/database';
import {
  articles,
  classifiers,
  clusters,
  issues,
  conversations,
  edition_issues,
  editions,
  fetchHistory,
  messages,
  reads,
  saves,
  savedSearches,
  sections,
  sources,
  subscriptions,
  users,
} from '@/domain/db/schema';
import { alias } from 'drizzle-orm/sqlite-core';
import type { FeedDetails, FeedElement, ScrapedItem } from '@/lib/scraping';

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
  /** Out of the paper now: muted, and the mute has not run out. */
  readonly muted: boolean;
  /** When a timed mute runs out (SQLite UTC); null when there is none. */
  readonly muted_until: string | null;
  readonly position: number;
  readonly created_at: string | null;
  readonly icon: string | null;
  readonly format: string | null;
  readonly site_url: string | null;
  readonly description: string | null;
  readonly language: string | null;
  readonly feed_updated_at: string | null;
  readonly update_minutes: number | null;
  readonly last_fetched_at: string | null;
  /** Every header element as stored JSON, or null before the first fetch. */
  readonly header: string | null;
}
/** How a feed's source is doing: its last fetch and recent output. */
export interface FeedStatistics {
  readonly last_fetched_at: string | null;
  readonly last_error: string | null;
  readonly fail_count: number;
  /** Minutes the feed asks to be left between fetches, when it says. */
  readonly update_minutes: number | null;
  /** People following the feed, and how many of them have it unmuted. */
  readonly subscribers: number;
  readonly active_subscribers: number;
  /** Stories kept, and those first seen in the last 30 days. */
  readonly story_count: number;
  readonly stories_last_month: number;
  /** Stories per edition day, newest first. */
  readonly stories_per_day: readonly {
    readonly date: string;
    readonly count: number;
  }[];
  /** Stories per month (`YYYY-MM`), newest first, and their mean. */
  readonly stories_per_month: readonly {
    readonly month: string;
    readonly count: number;
  }[];
  readonly average_stories_per_month: number;
  /** Stories by day of the week (0 = Sunday) and hour of the day (UTC). */
  readonly stories_per_weekday: Readonly<Record<string, number>>;
  readonly stories_per_hour: Readonly<Record<string, number>>;
  /** The latest fetches, newest first. */
  readonly fetch_history: readonly {
    readonly fetched_at: string | null;
    readonly ok: boolean;
    readonly message: string | null;
  }[];
}

/** How many fetches of a source are remembered. */
export const FETCH_HISTORY_LIMIT = 25;

/** The parts of a feed a person can change; null clears the title or section. */
export interface FeedChanges {
  readonly title?: string | null;
  readonly muted?: boolean;
  /** When the mute runs out (SQLite UTC), or null to mute for good. */
  readonly muted_until?: string | null;
  readonly section_id?: number | null;
  readonly position?: number;
  /** A new address for the feed: follow another source in its place. */
  readonly url?: string;
}
/** The parts of a section a person can change; a null parent is top level. */
export interface SectionChanges {
  readonly name?: string;
  readonly position?: number;
  readonly parent_id?: number | null;
}
/** An article scraped from a source. */
export type Article = typeof articles.$inferSelect;

/** An article as a list shows it: everything but its body text. */
export type ArticleSummary = Omit<Article, 'body_text'>;
/** Where a page of {@link Repository.searchArticles} starts and how long it is. */
export interface ArticleQuery {
  /** Words every article must contain; blank lists every article. */
  readonly q?: string;
  /** Only articles with a smaller id than this: the last one already shown. */
  readonly before?: number;
  /** Only articles from this feed (the person's subscription id). */
  readonly feed?: number;
  /** Oldest first instead of newest first; `before` then means after. */
  readonly oldest?: boolean;
  readonly limit: number;
}

/**
 * A person's search words as an FTS5 query: each word a quoted phrase, so the
 * operators and punctuation of FTS5 syntax are matched as text, never run.
 * Every word must appear. Empty when there are no words.
 */
export function ftsQuery(q: string): string {
  return q
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `"${word.replace(/"/g, '""')}"`)
    .join(' ');
}

/** A search a person keeps. */
export type SavedSearch = typeof savedSearches.$inferSelect;

/** What a fetch of a source learned besides its stories. */
export interface FetchOutcome {
  /** Why it failed; absent when it worked. */
  readonly error?: string;
  /** Minutes the server asked to be left alone for (`Retry-After`). */
  readonly retryAfter?: number;
  /** The validators of a successful answer, for the next conditional GET. */
  readonly etag?: string | null;
  readonly lastModified?: string | null;
}

/** Longest a failing source is left before it is tried again: a week. */
export const MAX_BACKOFF_MINUTES = 7 * 24 * 60;

/** Every column of an article but its body text: what a list selects. */
const summaryColumns = Object.fromEntries(
  Object.entries(getTableColumns(articles)).filter(
    ([name]) => name !== 'body_text',
  ),
) as Omit<ReturnType<typeof getTableColumns<typeof articles>>, 'body_text'>;
/** A like or dislike a person trained the paper with. */
export type Classifier = typeof classifiers.$inferSelect;
/** What a classifier matches on, and whether it likes (1) or dislikes (-1). */
export interface ClassifierInput {
  readonly kind: string;
  readonly value: string;
  readonly score: number;
}
/** A story a person kept: the article, their tags and when they saved it. */
export interface SavedStory {
  readonly article: ArticleSummary;
  readonly tags: readonly string[];
  readonly saved_at: string | null;
}
/** The stories a person has opened, by article id and by address. */
export interface ReadState {
  readonly ids: ReadonlySet<number>;
  readonly urls: ReadonlySet<string>;
}

/** An article of one edition as clustering compares it. */
export interface Clusterable {
  readonly id: number;
  readonly source_id: number;
  readonly title: string | null;
  readonly summary: string | null;
}
/** A person's stored paper for one day; `layout` is JSON. */
export type StoredIssue = typeof issues.$inferSelect;
/** A custom edition's stored paper for one day; `layout` is JSON. */
export type StoredEditionIssue = typeof edition_issues.$inferSelect;

/**
 * A named paper a person keeps beside their default one, with the rules that
 * pick its stories: the sections it prints (none for every feed), a search
 * its stories must match and a tag they must be saved under.
 */
export interface CustomEdition {
  readonly id: number;
  readonly user_id: number;
  readonly name: string;
  readonly section_ids: readonly number[];
  readonly query: string | null;
  readonly tag: string | null;
  readonly created_at: string | null;
}

/** What adding or changing a custom edition may set. */
export interface EditionChanges {
  readonly name?: string;
  readonly section_ids?: readonly number[];
  readonly query?: string | null;
  readonly tag?: string | null;
}

/** What trending ranks articles by. */
export type TrendingOrder = 'reads' | 'saves';

/** Where a page of {@link Repository.trendingArticles} starts and how long. */
export interface TrendingQuery {
  readonly order: TrendingOrder;
  /** Only reads or saves at or after this SQLite time count. */
  readonly since: string;
  /** The count and id of the last article of the page before. */
  readonly after?: { readonly count: number; readonly id: number };
  readonly limit: number;
}

/** An article with how many people read or saved it in the window. */
export interface TrendingArticle {
  readonly article: ArticleSummary;
  readonly count: number;
}

/** A stored section id list, or none when it is not a JSON array of ids. */
function idsOf(stored: string): number[] {
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.filter((n): n is number => Number.isInteger(n))
      : [];
  } catch {
    return [];
  }
}

/** A stored custom edition with its rules decoded. */
function editionOf(row: typeof editions.$inferSelect): CustomEdition {
  return { ...row, section_ids: idsOf(row.section_ids) };
}

/** Rows per IN list, below D1's limit of 100 bound parameters. */
const IN_CHUNK = 90;

/** `list` cut into runs of at most `size`. */
function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) {
    out.push(list.slice(i, i + size));
  }
  return out;
}

/** A stored tag list, or none when it is not a JSON array of strings. */
function tagsOf(stored: string): string[] {
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.filter((t): t is string => typeof t === 'string')
      : [];
  } catch {
    return [];
  }
}

/** One exchange a person has with the archive assistant. */
export type Conversation = typeof conversations.$inferSelect;
/** A turn of a conversation, with the ids of the articles it cites. */
export interface Message {
  readonly id: number;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly citations: readonly number[];
  readonly created_at: string | null;
}
/** An article the assistant may draw on: a summary and the start of its text. */
export interface Passage {
  readonly id: number;
  readonly title: string | null;
  readonly source: string | null;
  readonly summary: string | null;
  readonly text: string;
}
/** A source other readers like this person follow, and how many of them do. */
export interface SourceSuggestion {
  readonly id: number;
  readonly url: string;
  readonly title: string | null;
  readonly followers: number;
}

/** Characters of an article's text a {@link Passage} carries. */
const PASSAGE_LENGTH = 1500;

/** Words too common to find anything with. */
const STOPWORDS = new Set(
  'a an and are as at be but by did do does for from had has have how i in is it its me my of on or so than that the their them then there these they this to was we were what when where which who why will with you your'.split(
    ' ',
  ),
);

/**
 * A question as an FTS5 query that matches any of its words: each word of
 * three or more letters that is not a {@link STOPWORDS} word, quoted, joined
 * by OR. Empty when no word is left.
 */
export function anyWordQuery(question: string): string {
  const words = question
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return [...new Set(words)].map((w) => `"${w}"`).join(' OR ');
}

/** A stored citation list, or none when it is not a JSON array of numbers. */
function citationsOf(stored: string): number[] {
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed)
      ? parsed.filter((n): n is number => Number.isInteger(n))
      : [];
  } catch {
    return [];
  }
}

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
        muted:
          sql<boolean>`(${subscriptions.muted} != 0 and (${subscriptions.muted_until} is null or ${subscriptions.muted_until} > datetime('now')))`.mapWith(
            Boolean,
          ),
        muted_until: subscriptions.muted_until,
        position: subscriptions.position,
        created_at: subscriptions.created_at,
        icon: sources.icon,
        format: sources.format,
        site_url: sources.site_url,
        description: sources.description,
        language: sources.language,
        feed_updated_at: sources.feed_updated_at,
        update_minutes: sources.update_minutes,
        last_fetched_at: sources.last_fetched_at,
        header: sources.header,
      })
      .from(subscriptions)
      .innerJoin(sources, eq(subscriptions.source_id, sources.id));
  }

  listFeeds(userId: number): Promise<Feed[]> {
    return this.#feeds()
      .where(eq(subscriptions.user_id, userId))
      .orderBy(
        asc(subscriptions.position),
        asc(subscriptions.created_at),
        asc(subscriptions.id),
      );
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
      .values({ url, title: title || null })
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
   * Rename, mute, order or file one of the person's feeds. Undefined when it
   * is not theirs. A blank title goes back to the source's own; unmuting
   * clears any time the mute was to run out.
   */
  async updateFeed(
    userId: number,
    id: number,
    changes: FeedChanges,
  ): Promise<Feed | undefined> {
    const set: Partial<typeof subscriptions.$inferInsert> = {};
    if (changes.title !== undefined) set.title_override = changes.title || null;
    if (changes.muted !== undefined) set.muted = changes.muted ? 1 : 0;
    if (changes.muted_until !== undefined) {
      set.muted_until = changes.muted_until;
    }
    if (changes.muted === false) set.muted_until = null;
    if (changes.section_id !== undefined) set.section_id = changes.section_id;
    if (changes.position !== undefined) set.position = changes.position;
    if (changes.url !== undefined) {
      await this.#db
        .insert(sources)
        .values({ url: changes.url })
        .onConflictDoNothing({ target: sources.url });
      const target = await this.#db.query.sources.findFirst({
        where: eq(sources.url, changes.url),
      });
      if (target) set.source_id = target.id;
    }
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
      .selectDistinct(getTableColumns(sources))
      .from(sources)
      .innerJoin(subscriptions, eq(subscriptions.source_id, sources.id));
  }

  /**
   * Store what a feed says about itself. Its own title replaces none, but never
   * a title someone else gave the source.
   */
  async recordDetails(
    sourceId: number,
    details: FeedDetails,
    header: readonly FeedElement[],
  ): Promise<void> {
    await this.#db
      .update(sources)
      .set({
        title: details.title
          ? sql`coalesce(${sources.title}, ${details.title})`
          : sources.title,
        icon: details.icon || null,
        format: details.format ?? null,
        site_url: details.site_url || null,
        description: details.description || null,
        language: details.language || null,
        feed_updated_at: details.updated_at || null,
        update_minutes: details.update_minutes ?? null,
        header: JSON.stringify(header),
      })
      .where(eq(sources.id, sourceId));
  }

  /**
   * Note how a fetch of a source went: a success clears the error and the
   * failure count, a failure records why and counts it.
   */
  async recordFetch(
    sourceId: number,
    outcome: string | FetchOutcome = {},
  ): Promise<void> {
    const { error, retryAfter, etag, lastModified } =
      typeof outcome === 'string' ? { error: outcome } : outcome;
    // A day longer for each failure in a row before this one, up to a week,
    // or longer when the server asked for it (NewsBlur's geometric backoff on
    // a daily schedule). A source is never given up on.
    const wait = sql`max(min(${sources.fail_count} * 1440, ${MAX_BACKOFF_MINUTES}), ${retryAfter ?? 0})`;
    await this.#db
      .update(sources)
      .set(
        error
          ? {
              last_error: error,
              fail_count: sql`${sources.fail_count} + 1`,
              next_fetch_at: sql`datetime('now', '+' || ${wait} || ' minutes')`,
            }
          : {
              last_fetched_at: sql`(datetime('now'))`,
              last_error: null,
              fail_count: 0,
              next_fetch_at: null,
              ...(etag !== undefined ? { etag } : {}),
              ...(lastModified !== undefined
                ? { last_modified: lastModified }
                : {}),
            },
      )
      .where(eq(sources.id, sourceId));
    await this.#db.insert(fetchHistory).values({
      source_id: sourceId,
      ok: error ? 0 : 1,
      message: error ?? null,
    });
    await this.#db.run(
      sql`DELETE FROM fetch_history WHERE source_id = ${sourceId} AND id NOT IN (SELECT id FROM fetch_history WHERE source_id = ${sourceId} ORDER BY id DESC LIMIT ${FETCH_HISTORY_LIMIT})`,
    );
  }

  /** Forget a source's failures so the next fetch starts clean. */
  async clearFailures(sourceId: number): Promise<void> {
    await this.#db
      .update(sources)
      .set({ last_error: null, fail_count: 0 })
      .where(eq(sources.id, sourceId));
  }

  /**
   * The sources somebody follows that are due a fetch: never backed off, or
   * due within the hour (so a daily run a few seconds early still takes them).
   */
  async dueSources(): Promise<Source[]> {
    return (await this.allSources()).filter(
      (s) =>
        !s.next_fetch_at ||
        Date.parse(`${s.next_fetch_at.replace(' ', 'T')}Z`) <=
          Date.now() + 60 * 60 * 1000,
    );
  }

  /**
   * Point a source at the address its feed moved to for good. False, leaving
   * it alone, when another source already has that address.
   */
  async moveSource(sourceId: number, url: string): Promise<boolean> {
    const taken = await this.#db.query.sources.findFirst({
      where: eq(sources.url, url),
    });
    if (taken) return false;
    await this.#db
      .update(sources)
      .set({ url, etag: null, last_modified: null })
      .where(eq(sources.id, sourceId));
    return true;
  }

  /**
   * The person's sections, in the order they go down the page: each section
   * by position, followed by the sections nested under it.
   */
  async listSections(userId: number): Promise<Section[]> {
    const rows = await this.#db
      .select()
      .from(sections)
      .where(eq(sections.user_id, userId))
      .orderBy(asc(sections.position), asc(sections.id));
    return treeOrder(rows);
  }

  /** The person's section with this id, or undefined when it is not theirs. */
  getSection(userId: number, id: number): Promise<Section | undefined> {
    return this.#db.query.sections.findFirst({
      where: and(eq(sections.id, id), eq(sections.user_id, userId)),
    });
  }

  /**
   * Add a section, under `parentId` when given; without a position it goes
   * after its siblings.
   */
  async addSection(
    userId: number,
    name: string,
    position?: number,
    parentId: number | null = null,
  ): Promise<Section> {
    const at =
      position ??
      (await this.listSections(userId))
        .filter((s) => s.parent_id === parentId)
        .reduce((last, s) => Math.max(last, s.position + 1), 0);
    const rows = await this.#db
      .insert(sections)
      .values({ user_id: userId, name, position: at, parent_id: parentId })
      .returning();
    return rows[0]!;
  }

  /**
   * Rename, reorder or move a section under another. Undefined when it is not
   * the person's. Checking that a new parent is theirs and not the section or
   * one under it is {@link canNestUnder}'s job.
   */
  async updateSection(
    userId: number,
    id: number,
    changes: SectionChanges,
  ): Promise<Section | undefined> {
    if (Object.keys(changes).length) {
      await this.#db
        .update(sections)
        .set(changes)
        .where(and(eq(sections.id, id), eq(sections.user_id, userId)));
    }
    return this.getSection(userId, id);
  }

  /**
   * Whether section `id` (undefined for a new one) may nest under `parentId`:
   * the parent is the person's, and is neither the section nor one nested
   * under it.
   */
  async canNestUnder(
    userId: number,
    id: number | undefined,
    parentId: number,
  ): Promise<boolean> {
    const all = await this.listSections(userId);
    const parents = new Map(all.map((s) => [s.id, s.parent_id]));
    if (!parents.has(parentId)) return false;
    for (let at: number | null | undefined = parentId; at != null;) {
      if (at === id) return false;
      at = parents.get(at);
    }
    return true;
  }

  /**
   * Remove a section; its feeds stay, under no section, and the sections
   * nested in it move up to its parent. True when there was one to remove.
   */
  async removeSection(userId: number, id: number): Promise<boolean> {
    const removed = await this.#db
      .delete(sections)
      .where(and(eq(sections.id, id), eq(sections.user_id, userId)))
      .returning({ id: sections.id, parent_id: sections.parent_id });
    if (!removed.length) return false;
    await this.#db
      .update(sections)
      .set({ parent_id: removed[0]!.parent_id })
      .where(and(eq(sections.user_id, userId), eq(sections.parent_id, id)));
    await this.#db
      .update(subscriptions)
      .set({ section_id: null })
      .where(
        and(
          eq(subscriptions.user_id, userId),
          eq(subscriptions.section_id, id),
        ),
      );
    // An edition that printed the section stops naming it.
    for (const edition of await this.listCustomEditions(userId)) {
      if (edition.section_ids.includes(id)) {
        await this.updateCustomEdition(userId, edition.id, {
          section_ids: edition.section_ids.filter((s) => s !== id),
        });
      }
    }
    return true;
  }

  /**
   * Write one day's edition for a source: upsert the current items dated to
   * `edition`, then drop that edition's rows the feed no longer lists (stories
   * someone saved or read excepted). A same-day re-run is idempotent and keeps each story's
   * id, so links to it and state about it survive; text a re-run could not
   * fetch again is kept. Past editions are never touched — history is kept
   * indefinitely.
   */
  async writeEdition(
    sourceId: number,
    edition: string,
    items: ScrapedItem[],
  ): Promise<void> {
    // The addresses go in as one JSON parameter: D1 binds at most 100.
    const listed = JSON.stringify(items.map((a) => a.url));
    const stale = this.#db
      .delete(articles)
      .where(
        and(
          eq(articles.source_id, sourceId),
          eq(articles.edition, edition),
          sql`${articles.url} NOT IN (SELECT value FROM json_each(${listed}))`,
          notInArray(
            articles.id,
            this.#db.select({ id: saves.article_id }).from(saves),
          ),
          notInArray(
            articles.id,
            this.#db.select({ id: reads.article_id }).from(reads),
          ),
        ),
      );
    // One INSERT per row: a single multi-row insert blows past D1's ~100
    // bound-variable limit. db.batch runs them in one transaction.
    const upserts = items.map((a) => {
      const row = {
        title: a.title,
        source: a.source || '',
        image: a.image || '',
        favicon: a.favicon || '',
        summary: a.summary || '',
        published_at: a.published_at || '',
        points: a.points || 0,
        body_text: a.body_text || null,
        fetched_at: sql`(datetime('now'))`,
      };
      return this.#db
        .insert(articles)
        .values({ source_id: sourceId, url: a.url, edition, ...row })
        .onConflictDoUpdate({
          target: [articles.source_id, articles.url, articles.edition],
          set: {
            ...row,
            body_text: sql`coalesce(excluded.body_text, ${articles.body_text})`,
          },
        });
    });
    await this.#db.batch([stale, ...upserts]);
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

  /**
   * Distinct edition dates available for a user's feeds, newest first. Muted
   * feeds are out of the paper, so their days do not count.
   */
  async listEditions(userId: number): Promise<string[]> {
    const rows = await this.#db
      .selectDistinct({ edition: articles.edition })
      .from(articles)
      .innerJoin(subscriptions, eq(articles.source_id, subscriptions.source_id))
      .where(and(eq(subscriptions.user_id, userId), eq(subscriptions.muted, 0)))
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

  /** The ids of the sources a person follows, as a subquery. */
  #followed(userId: number) {
    return this.#db
      .select({ id: subscriptions.source_id })
      .from(subscriptions)
      .where(eq(subscriptions.user_id, userId));
  }

  /**
   * Articles from the sources a person follows, from every edition, newest
   * first. With `q`, only those whose title, summary or body text holds every
   * word, and with `feed`, only those from that one feed. A story a feed keeps
   * publishing is stored again in each day's edition, so only its newest copy
   * is listed. Asks for one more than `limit`, so the caller can tell whether
   * another page follows.
   */
  searchArticles(
    userId: number,
    { q = '', before, feed, oldest = false, limit }: ArticleQuery,
  ): Promise<ArticleSummary[]> {
    const match = ftsQuery(q);
    const newest = this.#db
      .select({ id: sql<number>`max(${articles.id})` })
      .from(articles)
      .groupBy(articles.source_id, articles.url);
    return this.#db
      .select(summaryColumns)
      .from(articles)
      .where(
        and(
          inArray(articles.source_id, this.#followed(userId)),
          match
            ? sql`${articles.id} IN (SELECT rowid FROM articles_fts WHERE articles_fts MATCH ${match})`
            : undefined,
          before !== undefined
            ? (oldest ? gt : lt)(articles.id, before)
            : undefined,
          feed !== undefined
            ? eq(
                articles.source_id,
                this.#db
                  .select({ id: subscriptions.source_id })
                  .from(subscriptions)
                  .where(
                    and(
                      eq(subscriptions.id, feed),
                      eq(subscriptions.user_id, userId),
                    ),
                  ),
              )
            : undefined,
          inArray(articles.id, newest),
        ),
      )
      .orderBy(oldest ? asc(articles.id) : desc(articles.id))
      .limit(limit + 1);
  }

  /**
   * Keep the text fetched for an article later; blank records that its page
   * held none, so it is not fetched again.
   */
  async setBodyText(id: number, text: string): Promise<void> {
    await this.#db
      .update(articles)
      .set({ body_text: text })
      .where(eq(articles.id, id));
  }

  /** The person's saved searches, newest first. */
  listSearches(userId: number): Promise<SavedSearch[]> {
    return this.#db
      .select()
      .from(savedSearches)
      .where(eq(savedSearches.user_id, userId))
      .orderBy(desc(savedSearches.created_at), desc(savedSearches.id));
  }

  /** The person's saved search with this id, or undefined. */
  getSearch(userId: number, id: number): Promise<SavedSearch | undefined> {
    return this.#db.query.savedSearches.findFirst({
      where: and(eq(savedSearches.id, id), eq(savedSearches.user_id, userId)),
    });
  }

  /**
   * Save a search, or find the same one saved before. `created` says which.
   */
  async addSearch(
    userId: number,
    query: string,
    feedId: number | null,
  ): Promise<{ search: SavedSearch; created: boolean }> {
    const same = and(
      eq(savedSearches.user_id, userId),
      eq(savedSearches.query, query),
      feedId === null
        ? isNull(savedSearches.feed_id)
        : eq(savedSearches.feed_id, feedId),
    );
    const existing = await this.#db.query.savedSearches.findFirst({
      where: same,
    });
    if (existing) return { search: existing, created: false };
    const [search] = await this.#db
      .insert(savedSearches)
      .values({ user_id: userId, query, feed_id: feedId })
      .returning();
    return { search: search!, created: true };
  }

  /** Forget a saved search. True when there was one to remove. */
  async removeSearch(userId: number, id: number): Promise<boolean> {
    const removed = await this.#db
      .delete(savedSearches)
      .where(and(eq(savedSearches.id, id), eq(savedSearches.user_id, userId)))
      .returning({ id: savedSearches.id });
    return removed.length > 0;
  }

  /**
   * One article with its body text, or undefined when there is none or it is
   * from a source the person does not follow.
   */
  async getArticle(userId: number, id: number): Promise<Article | undefined> {
    const [row] = await this.#db
      .select()
      .from(articles)
      .where(
        and(
          eq(articles.id, id),
          inArray(articles.source_id, this.#followed(userId)),
        ),
      )
      .limit(1);
    return row;
  }

  /** The person's classifiers, newest first. */
  listClassifiers(userId: number): Promise<Classifier[]> {
    return this.#db
      .select()
      .from(classifiers)
      .where(eq(classifiers.user_id, userId))
      .orderBy(desc(classifiers.created_at), desc(classifiers.id));
  }

  /**
   * Train the paper. A classifier for the same kind and value replaces the
   * score of the one already there; `created` says whether it is new.
   */
  async addClassifier(
    userId: number,
    input: ClassifierInput,
  ): Promise<{ readonly classifier: Classifier; readonly created: boolean }> {
    const existing = await this.#db.query.classifiers.findFirst({
      where: and(
        eq(classifiers.user_id, userId),
        eq(classifiers.kind, input.kind),
        eq(classifiers.value, input.value),
      ),
    });
    if (existing) {
      const [row] = await this.#db
        .update(classifiers)
        .set({ score: input.score })
        .where(eq(classifiers.id, existing.id))
        .returning();
      return { classifier: row!, created: false };
    }
    const [row] = await this.#db
      .insert(classifiers)
      .values({ user_id: userId, ...input })
      .returning();
    return { classifier: row!, created: true };
  }

  /** Forget a classifier. True when the person had one with this id. */
  async removeClassifier(userId: number, id: number): Promise<boolean> {
    const removed = await this.#db
      .delete(classifiers)
      .where(and(eq(classifiers.id, id), eq(classifiers.user_id, userId)))
      .returning({ id: classifiers.id });
    return removed.length > 0;
  }

  /**
   * Keep a story with these tags, replacing the tags of an earlier save.
   * Undefined when there is no such article in the person's feeds; `created` says whether it is new.
   */
  async saveArticle(
    userId: number,
    articleId: number,
    tags: readonly string[],
  ): Promise<
    { readonly story: SavedStory; readonly created: boolean } | undefined
  > {
    if (!(await this.getArticle(userId, articleId))) return undefined;
    const before = await this.getSave(userId, articleId);
    await this.#db
      .insert(saves)
      .values({
        user_id: userId,
        article_id: articleId,
        tags: JSON.stringify(tags),
      })
      .onConflictDoUpdate({
        target: [saves.user_id, saves.article_id],
        set: { tags: JSON.stringify(tags) },
      });
    const story = await this.getSave(userId, articleId);
    return { story: story!, created: !before };
  }

  /** The person's save of this article, or undefined when they have none. */
  async getSave(
    userId: number,
    articleId: number,
  ): Promise<SavedStory | undefined> {
    const [row] = await this.#saved()
      .where(and(eq(saves.user_id, userId), eq(saves.article_id, articleId)))
      .limit(1);
    return row ? this.#story(row) : undefined;
  }

  /** Stop keeping a story. True when the person had saved it. */
  async unsaveArticle(userId: number, articleId: number): Promise<boolean> {
    const removed = await this.#db
      .delete(saves)
      .where(and(eq(saves.user_id, userId), eq(saves.article_id, articleId)))
      .returning({ id: saves.article_id });
    return removed.length > 0;
  }

  /** The person's saved stories, newest save first, optionally with one tag. */
  async listSaves(userId: number, tag?: string): Promise<SavedStory[]> {
    const rows = await this.#saved()
      .where(
        and(
          eq(saves.user_id, userId),
          tag === undefined
            ? undefined
            : sql`exists (select 1 from json_each(${saves.tags}) where json_each.value = ${tag})`,
        ),
      )
      .orderBy(desc(saves.created_at), desc(saves.article_id));
    return rows.map((row) => this.#story(row));
  }

  /** Saves joined to their articles. */
  #saved() {
    return this.#db
      .select({
        article: summaryColumns,
        tags: saves.tags,
        saved_at: saves.created_at,
      })
      .from(saves)
      .innerJoin(articles, eq(saves.article_id, articles.id));
  }

  #story(row: {
    article: ArticleSummary;
    tags: string;
    saved_at: string | null;
  }): SavedStory {
    return {
      article: row.article,
      tags: tagsOf(row.tags),
      saved_at: row.saved_at,
    };
  }

  /**
   * Note that the person opened a story. Undefined when there is no such
   * article in their feeds, else whether this is the first time.
   */
  async markRead(
    userId: number,
    articleId: number,
  ): Promise<boolean | undefined> {
    if (!(await this.getArticle(userId, articleId))) return undefined;
    const added = await this.#db
      .insert(reads)
      .values({ user_id: userId, article_id: articleId })
      .onConflictDoNothing()
      .returning({ id: reads.article_id });
    return added.length > 0;
  }

  /** Forget that the person opened a story. True when they had. */
  async markUnread(userId: number, articleId: number): Promise<boolean> {
    const removed = await this.#db
      .delete(reads)
      .where(and(eq(reads.user_id, userId), eq(reads.article_id, articleId)))
      .returning({ id: reads.article_id });
    return removed.length > 0;
  }

  /** The stories the person has opened, by id and by address. */
  async readState(userId: number): Promise<ReadState> {
    const rows = await this.#db
      .select({ id: articles.id, url: articles.url })
      .from(reads)
      .innerJoin(articles, eq(reads.article_id, articles.id))
      .where(eq(reads.user_id, userId));
    return {
      ids: new Set(rows.map((r) => r.id)),
      urls: new Set(rows.map((r) => r.url)),
    };
  }

  /**
   * Fetch health and recent output of one of the person's feeds, or undefined
   * when it is not theirs. `days` bounds how many editions are counted.
   */
  async feedStatistics(
    userId: number,
    id: number,
    days = 14,
  ): Promise<FeedStatistics | undefined> {
    const feed = await this.getFeed(userId, id);
    if (!feed) return undefined;
    const source = await this.#db.query.sources.findFirst({
      where: eq(sources.id, feed.source_id),
    });
    if (!source) return undefined;
    const rows = await this.#db
      .select({ date: articles.edition, count: sql<number>`count(*)` })
      .from(articles)
      .where(
        and(
          eq(articles.source_id, source.id),
          sql`${articles.edition} is not null`,
        ),
      )
      .groupBy(articles.edition)
      .orderBy(desc(articles.edition))
      .limit(days);
    const where = (extra?: ReturnType<typeof sql>) =>
      and(eq(articles.source_id, source.id), extra);
    const bucket = async (
      expression: ReturnType<typeof sql>,
      extra: ReturnType<typeof sql>,
    ): Promise<Map<string, number>> => {
      const found = await this.#db
        .select({
          key: sql<string | null>`${expression}`,
          count: sql<number>`count(*)`,
        })
        .from(articles)
        .where(where(extra))
        .groupBy(expression);
      return new Map(
        found.flatMap((r) =>
          r.key === null ? [] : [[r.key, Number(r.count)] as const],
        ),
      );
    };
    const months = (
      await this.#db
        .select({
          month: sql<string>`substr(${articles.edition}, 1, 7)`,
          count: sql<number>`count(*)`,
        })
        .from(articles)
        .where(where(sql`${articles.edition} is not null`))
        .groupBy(sql`substr(${articles.edition}, 1, 7)`)
        .orderBy(desc(sql`substr(${articles.edition}, 1, 7)`))
        .limit(12)
    ).map((r) => ({ month: r.month, count: Number(r.count) }));
    const weekdays = await bucket(
      sql`strftime('%w', ${articles.edition})`,
      sql`${articles.edition} is not null`,
    );
    const hours = await bucket(
      sql`strftime('%H', ${articles.published_at})`,
      sql`${articles.published_at} is not null`,
    );
    const [totals] = await this.#db
      .select({
        total: sql<number>`count(*)`,
        recent: sql<number>`coalesce(sum(${articles.edition} >= date('now', '-30 day')), 0)`,
      })
      .from(articles)
      .where(where());
    const [followers] = await this.#db
      .select({
        all: sql<number>`count(*)`,
        active: sql<number>`coalesce(sum(${subscriptions.muted} = 0), 0)`,
      })
      .from(subscriptions)
      .where(eq(subscriptions.source_id, source.id));
    const history = await this.#db
      .select()
      .from(fetchHistory)
      .where(eq(fetchHistory.source_id, source.id))
      .orderBy(desc(fetchHistory.id))
      .limit(FETCH_HISTORY_LIMIT);
    return {
      last_fetched_at: source.last_fetched_at,
      last_error: source.last_error,
      fail_count: source.fail_count,
      update_minutes: source.update_minutes,
      subscribers: Number(followers?.all ?? 0),
      active_subscribers: Number(followers?.active ?? 0),
      story_count: Number(totals?.total ?? 0),
      stories_last_month: Number(totals?.recent ?? 0),
      stories_per_day: rows.map((r) => ({
        date: r.date ?? '',
        count: Number(r.count),
      })),
      stories_per_month: months,
      average_stories_per_month: months.length
        ? Math.round(
            (months.reduce((n, m) => n + m.count, 0) / months.length) * 10,
          ) / 10
        : 0,
      stories_per_weekday: Object.fromEntries(weekdays),
      stories_per_hour: Object.fromEntries(hours),
      fetch_history: history.map((h) => ({
        fetched_at: h.fetched_at,
        ok: h.ok !== 0,
        message: h.message,
      })),
    };
  }

  /**
   * How many stories each of a person's feeds has kept, by feed id. A story
   * stored again in later editions counts once; a feed with none is absent.
   */
  async storyCounts(userId: number): Promise<Map<number, number>> {
    const rows = await this.#db
      .select({
        id: subscriptions.id,
        count: sql<number>`count(distinct ${articles.url})`,
      })
      .from(subscriptions)
      .innerJoin(articles, eq(articles.source_id, subscriptions.source_id))
      .where(eq(subscriptions.user_id, userId))
      .groupBy(subscriptions.id);
    return new Map(rows.map((r) => [r.id, Number(r.count)]));
  }

  /** Every article of one edition, from every source, for clustering. */
  editionArticles(edition: string): Promise<Clusterable[]> {
    return this.#db
      .select({
        id: articles.id,
        source_id: articles.source_id,
        title: articles.title,
        summary: articles.summary,
      })
      .from(articles)
      .where(eq(articles.edition, edition))
      .orderBy(asc(articles.id));
  }

  /**
   * Replace one edition's clusters: each group of article ids becomes a
   * cluster its members point at, and every other article of the edition
   * belongs to none.
   */
  async writeClusters(
    edition: string,
    groups: readonly (readonly number[])[],
  ): Promise<void> {
    await this.#db.batch([
      this.#db
        .update(articles)
        .set({ cluster_id: null })
        .where(eq(articles.edition, edition)),
      this.#db.delete(clusters).where(eq(clusters.edition, edition)),
    ]);
    for (const group of groups) {
      const [cluster] = await this.#db
        .insert(clusters)
        .values({ edition })
        .returning({ id: clusters.id });
      if (!cluster) continue;
      for (const ids of chunks(group, IN_CHUNK)) {
        await this.#db
          .update(articles)
          .set({ cluster_id: cluster.id })
          .where(inArray(articles.id, ids));
      }
    }
  }

  /** The articles with these ids, in no particular order. */
  async articlesByIds(ids: readonly number[]): Promise<Article[]> {
    const rows: Article[] = [];
    for (const part of chunks([...new Set(ids)], IN_CHUNK)) {
      rows.push(
        ...(await this.#db
          .select()
          .from(articles)
          .where(inArray(articles.id, part))),
      );
    }
    return rows;
  }

  /** The ids of everyone who follows at least one feed. */
  async readerIds(): Promise<number[]> {
    const rows = await this.#db
      .selectDistinct({ id: subscriptions.user_id })
      .from(subscriptions)
      .orderBy(asc(subscriptions.user_id));
    return rows.map((r) => r.id);
  }

  /** Store (or replace) a person's paper for one day. */
  async saveIssue(
    userId: number,
    date: string,
    layout: string,
    briefing: string | null,
  ): Promise<void> {
    await this.#db
      .insert(issues)
      .values({ user_id: userId, date, layout, briefing })
      .onConflictDoUpdate({
        target: [issues.user_id, issues.date],
        set: { layout, briefing, created_at: sql`(datetime('now'))` },
      });
  }

  /** A person's stored paper for one day, if one was laid out. */
  getIssue(userId: number, date: string): Promise<StoredIssue | undefined> {
    return this.#db.query.issues.findFirst({
      where: and(eq(issues.user_id, userId), eq(issues.date, date)),
    });
  }

  /** The person's custom editions, oldest first. */
  async listCustomEditions(userId: number): Promise<CustomEdition[]> {
    const rows = await this.#db
      .select()
      .from(editions)
      .where(eq(editions.user_id, userId))
      .orderBy(asc(editions.id));
    return rows.map(editionOf);
  }

  /** Every custom edition, for the daily run to lay out. */
  async allCustomEditions(): Promise<CustomEdition[]> {
    const rows = await this.#db
      .select()
      .from(editions)
      .orderBy(asc(editions.id));
    return rows.map(editionOf);
  }

  /** The person's custom edition with this id, or undefined if not theirs. */
  async getCustomEdition(
    userId: number,
    id: number,
  ): Promise<CustomEdition | undefined> {
    const row = await this.#db.query.editions.findFirst({
      where: and(eq(editions.id, id), eq(editions.user_id, userId)),
    });
    return row ? editionOf(row) : undefined;
  }

  /** Add a custom edition. */
  async addCustomEdition(
    userId: number,
    changes: EditionChanges & { readonly name: string },
  ): Promise<CustomEdition> {
    const rows = await this.#db
      .insert(editions)
      .values({
        user_id: userId,
        name: changes.name,
        section_ids: JSON.stringify(changes.section_ids ?? []),
        query: changes.query ?? null,
        tag: changes.tag ?? null,
      })
      .returning();
    return editionOf(rows[0]!);
  }

  /** Change a custom edition. Undefined when it is not the person's. */
  async updateCustomEdition(
    userId: number,
    id: number,
    { section_ids, ...rest }: EditionChanges,
  ): Promise<CustomEdition | undefined> {
    const set = {
      ...rest,
      ...(section_ids ? { section_ids: JSON.stringify(section_ids) } : {}),
    };
    if (Object.keys(set).length) {
      await this.#db
        .update(editions)
        .set(set)
        .where(and(eq(editions.id, id), eq(editions.user_id, userId)));
    }
    return this.getCustomEdition(userId, id);
  }

  /**
   * Remove a custom edition and the issues it printed. True when there was
   * one to remove.
   */
  async removeCustomEdition(userId: number, id: number): Promise<boolean> {
    const removed = await this.#db
      .delete(editions)
      .where(and(eq(editions.id, id), eq(editions.user_id, userId)))
      .returning({ id: editions.id });
    if (!removed.length) return false;
    await this.#db
      .delete(edition_issues)
      .where(eq(edition_issues.edition_id, id));
    return true;
  }

  /** Store (or replace) a custom edition's paper for one day. */
  async saveEditionIssue(
    editionId: number,
    date: string,
    layout: string,
    briefing: string | null,
  ): Promise<void> {
    await this.#db
      .insert(edition_issues)
      .values({ edition_id: editionId, date, layout, briefing })
      .onConflictDoUpdate({
        target: [edition_issues.edition_id, edition_issues.date],
        set: { layout, briefing, created_at: sql`(datetime('now'))` },
      });
  }

  /** A custom edition's stored paper for one day, if one was laid out. */
  async getEditionIssue(
    editionId: number,
    date: string,
  ): Promise<StoredEditionIssue | undefined> {
    return this.#db.query.edition_issues.findFirst({
      where: and(
        eq(edition_issues.edition_id, editionId),
        eq(edition_issues.date, date),
      ),
    });
  }

  /** The ids of the articles of `edition` whose text holds every word of `q`. */
  async matchingArticleIds(edition: string, q: string): Promise<Set<number>> {
    const match = ftsQuery(q);
    if (!match) return new Set();
    const rows = await this.#db
      .select({ id: articles.id })
      .from(articles)
      .where(
        and(
          eq(articles.edition, edition),
          sql`${articles.id} IN (SELECT rowid FROM articles_fts WHERE articles_fts MATCH ${match})`,
        ),
      );
    return new Set(rows.map((r) => r.id));
  }

  /** The ids of the articles the person saved under `tag`. */
  async taggedArticleIds(userId: number, tag: string): Promise<Set<number>> {
    const rows = await this.#db
      .select({ id: saves.article_id })
      .from(saves)
      .where(
        and(
          eq(saves.user_id, userId),
          sql`exists (select 1 from json_each(${saves.tags}) where json_each.value = ${tag})`,
        ),
      );
    return new Set(rows.map((r) => r.id));
  }

  /**
   * The articles from sources the person follows that most people read (or
   * saved) since `since`, most first, then newest. Only the counts leave the
   * database, never who read or saved. Asks for one more than `limit`, so the
   * caller can tell whether another page follows.
   */
  async trendingArticles(
    userId: number,
    { order, since, after, limit }: TrendingQuery,
  ): Promise<TrendingArticle[]> {
    const acts = order === 'reads' ? reads : saves;
    const count = sql<number>`count(*)`;
    const rows = await this.#db
      .select({ article: summaryColumns, count })
      .from(acts)
      .innerJoin(articles, eq(acts.article_id, articles.id))
      .where(
        and(
          sql`${acts.created_at} >= ${since}`,
          inArray(articles.source_id, this.#followed(userId)),
        ),
      )
      .groupBy(articles.id)
      .having(
        after
          ? sql`${count} < ${after.count} OR (${count} = ${after.count} AND ${articles.id} < ${after.id})`
          : undefined,
      )
      .orderBy(desc(count), desc(articles.id))
      .limit(limit + 1);
    return rows.map((r) => ({ article: r.article, count: Number(r.count) }));
  }

  /**
   * The articles a person may ask the assistant about (from sources they
   * follow, or ones they saved or read) that hold any word of `question`,
   * best match first, as passages.
   */
  async retrievePassages(
    userId: number,
    question: string,
    limit = 6,
  ): Promise<Passage[]> {
    const match = anyWordQuery(question);
    if (!match) return [];
    const mine = (table: typeof saves | typeof reads) =>
      this.#db
        .select({ id: table.article_id })
        .from(table)
        .where(eq(table.user_id, userId));
    return this.#db
      .select({
        id: articles.id,
        title: articles.title,
        source: articles.source,
        summary: articles.summary,
        text: sql<string>`substr(coalesce(${articles.body_text}, ''), 1, ${PASSAGE_LENGTH})`,
      })
      .from(articles)
      .innerJoin(sql`articles_fts f`, sql`f.rowid = ${articles.id}`)
      .where(
        and(
          sql`articles_fts MATCH ${match}`,
          or(
            inArray(articles.source_id, this.#followed(userId)),
            inArray(articles.id, mine(saves)),
            inArray(articles.id, mine(reads)),
          ),
        ),
      )
      .orderBy(sql`f.rank`, desc(articles.id))
      .limit(limit);
  }

  /** The titles of these articles, by id; ids with no article are left out. */
  async articleTitles(
    ids: readonly number[],
  ): Promise<Map<number, string | null>> {
    if (!ids.length) return new Map();
    const rows = await this.#db
      .select({ id: articles.id, title: articles.title })
      .from(articles)
      .where(inArray(articles.id, [...new Set(ids)]));
    return new Map(rows.map((r) => [r.id, r.title]));
  }

  /** Start a conversation with the assistant. */
  async addConversation(userId: number): Promise<Conversation> {
    const [row] = await this.#db
      .insert(conversations)
      .values({ user_id: userId })
      .returning();
    return row!;
  }

  /** The person's conversation with this id, or undefined when it is not theirs. */
  async getConversation(
    userId: number,
    id: number,
  ): Promise<Conversation | undefined> {
    const [row] = await this.#db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.user_id, userId)))
      .limit(1);
    return row;
  }

  /** The turns of a conversation, oldest first. */
  async listMessages(conversationId: number): Promise<Message[]> {
    const rows = await this.#db
      .select()
      .from(messages)
      .where(eq(messages.conversation_id, conversationId))
      .orderBy(asc(messages.id));
    return rows.map((row) => this.#message(row));
  }

  /** Add a turn to a conversation. */
  async addMessage(
    conversationId: number,
    role: Message['role'],
    content: string,
    citations: readonly number[] = [],
  ): Promise<Message> {
    const [row] = await this.#db
      .insert(messages)
      .values({
        conversation_id: conversationId,
        role,
        content,
        citations: JSON.stringify(citations),
      })
      .returning();
    return this.#message(row!);
  }

  #message(row: typeof messages.$inferSelect): Message {
    return {
      id: row.id,
      role: row.role === 'assistant' ? 'assistant' : 'user',
      content: row.content,
      citations: citationsOf(row.citations),
      created_at: row.created_at,
    };
  }

  /**
   * Sources that people who share a source with this person also follow, and
   * this person does not, most shared first: co-subscription.
   */
  async suggestSources(
    userId: number,
    limit = 10,
  ): Promise<SourceSuggestion[]> {
    const peer = alias(subscriptions, 'peer');
    const theirs = alias(subscriptions, 'theirs');
    const rows = await this.#db
      .select({
        id: sources.id,
        url: sources.url,
        title: sources.title,
        followers: sql<number>`count(distinct ${theirs.user_id})`,
      })
      .from(subscriptions)
      .innerJoin(
        peer,
        and(
          eq(peer.source_id, subscriptions.source_id),
          ne(peer.user_id, userId),
        ),
      )
      .innerJoin(theirs, eq(theirs.user_id, peer.user_id))
      .innerJoin(sources, eq(sources.id, theirs.source_id))
      .where(
        and(
          eq(subscriptions.user_id, userId),
          notInArray(theirs.source_id, this.#followed(userId)),
        ),
      )
      .groupBy(sources.id)
      .orderBy(sql`count(distinct ${theirs.user_id}) desc`, asc(sources.id))
      .limit(limit);
    return rows.map((r) => ({ ...r, followers: Number(r.followers) }));
  }
}

/**
 * Sections in page order: top-level ones in the order given, each followed by
 * the sections nested under it. A section whose parent is gone counts as top
 * level.
 */
export function treeOrder(rows: readonly Section[]): Section[] {
  const ids = new Set(rows.map((s) => s.id));
  const children = new Map<number | null, Section[]>();
  for (const s of rows) {
    const parent =
      s.parent_id !== null && ids.has(s.parent_id) ? s.parent_id : null;
    children.set(parent, [...(children.get(parent) ?? []), s]);
  }
  const out: Section[] = [];
  const seen = new Set<number>();
  const visit = (parent: number | null): void => {
    for (const s of children.get(parent) ?? []) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      out.push(s);
      visit(s.id);
    }
  };
  visit(null);
  // A cycle has no way in from the top; print what it holds at the end.
  return [...out, ...rows.filter((s) => !seen.has(s.id))];
}

/** The ids of `id` and every section nested under it, however deep. */
export function sectionAndDescendants(
  all: readonly Section[],
  id: number,
): Set<number> {
  const found = new Set([id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const s of all) {
      if (s.parent_id !== null && found.has(s.parent_id) && !found.has(s.id)) {
        found.add(s.id);
        grew = true;
      }
    }
  }
  return found;
}

/** A section's heading: its name after the names of the sections it is in. */
export function sectionPath(all: readonly Section[], id: number): string {
  const byId = new Map(all.map((s) => [s.id, s]));
  const names: string[] = [];
  const seen = new Set<number>();
  for (let at = byId.get(id); at && !seen.has(at.id);) {
    seen.add(at.id);
    names.unshift(at.name);
    at = at.parent_id === null ? undefined : byId.get(at.parent_id);
  }
  return names.join(' · ');
}
