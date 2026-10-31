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
  inArray,
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
  messages,
  reads,
  saves,
  sections,
  sources,
  subscriptions,
  users,
} from '@/domain/db/schema';
import { alias } from 'drizzle-orm/sqlite-core';
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
/** How a feed's source is doing: its last fetch and recent output. */
export interface FeedStatistics {
  readonly last_fetched_at: string | null;
  readonly last_error: string | null;
  readonly fail_count: number;
  /** Stories per edition day, newest first. */
  readonly stories_per_day: readonly {
    readonly date: string;
    readonly count: number;
  }[];
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

/** An article as a list shows it: everything but its body text. */
export type ArticleSummary = Omit<Article, 'body_text'>;
/** Where a page of {@link Repository.searchArticles} starts and how long it is. */
export interface ArticleQuery {
  /** Words every article must contain; blank lists every article. */
  readonly q?: string;
  /** Only articles with a smaller id than this: the last one already shown. */
  readonly before?: number;
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
   * same-day re-run is idempotent, saved stories excepted) and insert the current items dated to
   * `edition`. Past editions are never touched — history is kept indefinitely.
   */
  async writeEdition(
    sourceId: number,
    edition: string,
    items: ScrapedItem[],
  ): Promise<void> {
    // A saved story outlives its edition being rewritten.
    const del = this.#db
      .delete(articles)
      .where(
        and(
          eq(articles.source_id, sourceId),
          eq(articles.edition, edition),
          notInArray(
            articles.id,
            this.#db.select({ id: saves.article_id }).from(saves),
          ),
        ),
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
          body_text: a.body_text || null,
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
   * word. Asks for one more than `limit`, so the caller can tell whether
   * another page follows.
   */
  searchArticles(
    userId: number,
    { q = '', before, limit }: ArticleQuery,
  ): Promise<ArticleSummary[]> {
    const match = ftsQuery(q);
    return this.#db
      .select(summaryColumns)
      .from(articles)
      .where(
        and(
          inArray(articles.source_id, this.#followed(userId)),
          match
            ? sql`${articles.id} IN (SELECT rowid FROM articles_fts WHERE articles_fts MATCH ${match})`
            : undefined,
          before !== undefined ? lt(articles.id, before) : undefined,
        ),
      )
      .orderBy(desc(articles.id))
      .limit(limit + 1);
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
    return {
      last_fetched_at: source.last_fetched_at,
      last_error: source.last_error,
      fail_count: source.fail_count,
      stories_per_day: rows.map((r) => ({
        date: r.date ?? '',
        count: Number(r.count),
      })),
    };
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
