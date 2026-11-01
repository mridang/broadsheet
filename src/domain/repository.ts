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
  gte,
  inArray,
  lte,
  isNull,
  lt,
  ne,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';

import { type Database } from '@/domain/db/database';
import {
  ai_usage,
  answers,
  articles,
  classifiers,
  clusters,
  briefings,
  issues,
  preferences,
  prompt_scores,
  conversations,
  edition_issues,
  editions,
  fetchHistory,
  messages,
  reads,
  saves,
  shares,
  savedSearches,
  sections,
  sources,
  subscription_sections,
  subscriptions,
  users,
} from '@/domain/db/schema';
import { alias } from 'drizzle-orm/sqlite-core';
import {
  byRank,
  decayWeight,
  diversify,
  domainOf,
  LIST_SIZE,
  MAX_READ_SECONDS,
  MIN_FOLLOW_SCORE,
  MIN_PEOPLE,
  MIN_READ_SECONDS,
  rank,
  SMALL_FEED_SLOTS,
  titleKey,
  topicOf,
} from '@/domain/trending';
import type {
  FeedActivity,
  FeedDetails,
  FeedElement,
  ScrapedItem,
} from '@/lib/scraping';
import type { Intelligence } from '@/domain/render/tiers';

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
  /** Every section the feed sits in, the one it prints under first. */
  readonly section_ids: readonly number[];
  /** The person's own icon for the feed as stored JSON, or null. */
  readonly custom_icon: string | null;
  /** Days until its stories count as read: null inherits, 0 never. */
  readonly auto_mark_read_days: number | null;
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
    readonly duration_ms: number | null;
  }[];
  /** When the source may be fetched again; null when it is due now. */
  readonly next_fetch_at: string | null;
  /** Stories whose full text has been kept. */
  readonly archive_count: number;
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
  /** Every section to file the feed in, the one it prints under first. */
  readonly section_ids?: readonly number[];
  readonly position?: number;
  /** A new address for the feed: follow another source in its place. */
  readonly url?: string;
  /** The icon as stored JSON, or null for the feed's own. */
  readonly custom_icon?: string | null;
  readonly auto_mark_read_days?: number | null;
}
/**
 * The parts of a section a person can change; a null parent is top level and
 * null days inherit.
 */
export interface SectionChanges {
  readonly name?: string;
  readonly position?: number;
  readonly parent_id?: number | null;
  /** The icon as stored JSON, or null for none. */
  readonly icon?: string | null;
  readonly auto_mark_read_days?: number | null;
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
  /** Only articles from any of these feeds (subscription ids). */
  readonly feeds?: readonly number[];
  /** Only articles whose address is on this host or one under it. */
  readonly domain?: string;
  /** Only articles from editions on or after this date (YYYY-MM-DD). */
  readonly from?: string;
  /** Only articles from editions on or before this date (YYYY-MM-DD). */
  readonly to?: string;
  /** Oldest first, with `before` then meaning "after this id". */
  readonly oldest?: boolean;
  readonly limit: number;
}

/** How much of a person's archive there is. */
export interface ArchiveStats {
  readonly articles: number;
  readonly editions: number;
  readonly oldest_edition: string | null;
  readonly newest_edition: string | null;
  readonly saved: number;
  readonly read: number;
  /** Articles per feed, by subscription id, most first. */
  readonly feeds: readonly {
    readonly feed_id: number;
    readonly title: string;
    readonly articles: number;
  }[];
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
  /** How long the fetch took, in milliseconds. */
  readonly durationMs?: number;
  /** Minutes until a successful source is due again; due now when absent. */
  readonly nextFetch?: number;
}

/** A source due this soon is taken by the run that sees it. */
const DUE_SLACK_MS = 4 * 60 * 1000;

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
/**
 * What a classifier matches on, whether it likes (1), dislikes (-1) or super
 * dislikes (-2), and where: one feed, one section, or (neither) everywhere.
 */
export interface ClassifierInput {
  readonly kind: string;
  readonly value: string;
  readonly score: number;
  readonly scope_feed_id?: number;
  readonly scope_section_id?: number;
  /** The value is a regular expression. */
  readonly is_regex?: boolean;
}
/** A story a person kept: the article, their tags and when they saved it. */
export interface SavedStory {
  readonly article: ArticleSummary;
  readonly tags: readonly string[];
  readonly saved_at: string | null;
  /** The person's note on it, or null. */
  readonly notes?: string | null;
  /** Passages they marked. */
  readonly highlights?: readonly string[];
}
/** Which unread stories a bulk mark-read covers; absent members cover all. */
export interface ReadScope {
  readonly sourceIds?: readonly number[];
  readonly articleIds?: readonly number[];
  readonly edition?: string;
  readonly before?: Date;
  readonly after?: Date;
}

/**
 * When a story came out, in ms: its published time, else when it was fetched
 * (SQLite's UTC `YYYY-MM-DD HH:MM:SS`); NaN when neither is known.
 */
export function storyTime(
  a: Pick<Article, 'published_at' | 'fetched_at'>,
): number {
  if (a.published_at) return Date.parse(a.published_at);
  return a.fetched_at
    ? Date.parse(`${a.fetched_at.replace(' ', 'T')}Z`)
    : Number.NaN;
}

/** A tag on a person's saves and how many saves carry it. */
export interface TagCount {
  readonly tag: string;
  readonly count: number;
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
  /** The source's own title, whose words say nothing about the story. */
  readonly feed_title: string | null;
}
/** What a person chose about clustering and the editor's note. */
export interface Preferences {
  readonly story_clustering: boolean;
  readonly cluster_mode: 'title' | 'related';
  readonly cluster_mark_read: boolean;
  readonly cluster_preview_style: 'single_line' | 'expanded';
  readonly briefing_enabled: boolean;
  readonly briefing_story_count: number;
  readonly briefing_length: 'short' | 'medium' | 'detailed';
  readonly briefing_style: 'editorial' | 'bullets' | 'headlines';
  readonly briefing_read_filter: 'unread' | 'focus';
  /** How much of the paper training lets through (NewsBlur's intelligence). */
  readonly intelligence: Intelligence;
  /** Whether opening a story marks it read. */
  readonly mark_read_on_open: boolean;
  /** Days after which stories count as read when no feed or section says; 0 never. */
  readonly auto_mark_read_days: number;
  readonly briefing_frequency:
    'daily' | 'twice_daily' | 'thrice_daily' | 'weekly';
  /** `auto`, `morning`, `afternoon`, `evening`, or a time written HH:MM. */
  readonly briefing_time: string;
  /** The weekday a weekly briefing comes: `sun` to `sat`. */
  readonly briefing_day: string;
  /** The person's IANA time zone, such as `Europe/Helsinki`. */
  readonly timezone: string;
  /** `all`, or `section:{id}` for one section and those nested in it. */
  readonly briefing_sources: string;
  readonly briefing_include_read: boolean;
  /** The Workers AI model, or null for the server's default. */
  readonly briefing_model: string | null;
  /** Each section the person turned on or off; absent ones are on. */
  readonly briefing_sections: Readonly<Record<string, boolean>>;
  /** The order the person put the sections in; null for the default. */
  readonly briefing_section_order: readonly string[] | null;
  /** Keyword prompts for sections of the person's own, at most five. */
  readonly briefing_prompts: readonly string[];
  /** Whether stories scrolled past are marked read. */
  readonly mark_read_on_scroll: boolean;
}
/** The preferences of someone who has changed nothing. */
export const DEFAULT_PREFERENCES: Preferences = {
  story_clustering: true,
  cluster_mode: 'related',
  cluster_mark_read: false,
  cluster_preview_style: 'single_line',
  briefing_enabled: true,
  briefing_story_count: 5,
  briefing_length: 'medium',
  briefing_style: 'bullets',
  briefing_read_filter: 'unread',
  intelligence: 'unread',
  mark_read_on_open: true,
  auto_mark_read_days: 0,
  briefing_frequency: 'daily',
  briefing_time: 'morning',
  briefing_day: 'sun',
  timezone: 'UTC',
  briefing_sources: 'all',
  briefing_include_read: false,
  briefing_model: null,
  briefing_sections: {},
  briefing_section_order: null,
  briefing_prompts: [],
  mark_read_on_scroll: false,
};

/** A stored JSON value, or `fallback` when it does not parse. */
function storedJson<T>(
  stored: string | null,
  fallback: T,
  valid: (v: unknown) => boolean,
): T {
  if (!stored) return fallback;
  try {
    const parsed: unknown = JSON.parse(stored);
    return valid(parsed) ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

/** `value` when it is one of `allowed`, else `fallback`. */
function oneOf<T extends string>(
  value: string,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.find((a) => a === value) ?? fallback;
}

const isStringList = (v: unknown): boolean =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');

const isSwitches = (v: unknown): boolean =>
  typeof v === 'object' &&
  v !== null &&
  !Array.isArray(v) &&
  Object.values(v).every((x) => typeof x === 'boolean');

/** A briefing as it is stored. */
export type StoredBriefing = typeof briefings.$inferSelect;
/** A briefing about to be stored. */
export type NewBriefing = Omit<
  typeof briefings.$inferInsert,
  'id' | 'created_at'
>;

/** One day in a person's list of stored issues. */
export interface IssueListing {
  readonly date: string;
  readonly briefing: string | null;
  readonly created_at: string | null;
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

/**
 * What trending ranks articles by, as NewsBlur's lists do: `reads` the well
 * read (distinct readers), `read_time` the seconds spent, `long_reads` the
 * long stories people read through, `good_reads` the ones they read deeply
 * and kept, and `saves` the most saved.
 */
export const TRENDING_ORDERS = [
  'reads',
  'saves',
  'read_time',
  'long_reads',
  'good_reads',
] as const;

/** What trending ranks articles by. */
export type TrendingOrder = (typeof TRENDING_ORDERS)[number];

/** Where a page of {@link Repository.trendingArticles} starts and how long. */
export interface TrendingQuery {
  readonly order: TrendingOrder;
  /** Only reads or saves at or after this SQLite time count. */
  readonly since: string;
  /** The place in the list and id of the last article of the page before. */
  readonly after?: { readonly position: number; readonly id: number };
  /** Leave out the stories the person has read. */
  readonly unread?: boolean;
  /** `oldest` serves the list from its end, as NewsBlur's `order=oldest`. */
  readonly sort?: 'newest' | 'oldest';
  readonly limit: number;
}

/**
 * An article with its trending count in the window: people who read or saved
 * it, or for `read_time` the seconds they spent.
 */
export interface TrendingArticle {
  readonly article: ArticleSummary;
  readonly count: number;
  /** Its place in the served list, for the cursor. */
  readonly position: number;
}

/** What trending ranks sources by: readers, seconds read, or new followers. */
export const SOURCE_ORDERS = ['reads', 'read_time', 'follows'] as const;

/** What trending ranks sources by. */
export type SourceOrder = (typeof SOURCE_ORDERS)[number];

/** Where a page of {@link Repository.trendingSources} starts and how long. */
export interface SourceTrendingQuery {
  readonly order: SourceOrder;
  /** Only reads or follows at or after this SQLite time count. */
  readonly since: string;
  /** Sources with no story since this edition date are stale and left out. */
  readonly freshSince: string;
  /** The window in days, and now as a SQLite time, to age follows by. */
  readonly days: number;
  readonly now: string;
  readonly after?: { readonly count: number; readonly id: number };
  readonly limit: number;
}

/** A source with its trending count: people, or seconds for `read_time`. */
export interface TrendingSource {
  readonly id: number;
  readonly url: string;
  readonly title: string | null;
  readonly site_url: string | null;
  readonly followers: number;
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

/** A stored string list (tags, highlights), or none when it is not a JSON array of strings. */
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
  /** The day it was published, else the day of its edition. */
  readonly date: string | null;
}
/** Narrows a {@link Repository.retrievePassages} search. */
export interface PassageQuery {
  /** Only stories from this day (YYYY-MM-DD) on. */
  readonly since?: string;
  /** Only stories up to this day (YYYY-MM-DD). */
  readonly until?: string;
  /** Only stories whose source name or address holds this text. */
  readonly source?: string;
  readonly limit?: number;
}
/** What a person's archive holds, for the assistant to get its bearings. */
export interface ArchiveSummary {
  readonly sources: number;
  readonly articles: number;
  readonly saves: number;
  readonly reads: number;
  readonly top_sources: readonly {
    readonly source: string;
    readonly count: number;
  }[];
  readonly tags: readonly { readonly tag: string; readonly count: number }[];
}
/** A conversation as a list shows it. */
export type ConversationSummary = typeof conversations.$inferSelect;
/** What Ask AI or the assistant may be asked: its daily budget. */
export type UsageKind = 'answer' | 'assistant' | 'classifier';
/** A story like another, from any source, and whether the person follows its source. */
export interface DiscoveredArticle {
  readonly article: ArticleSummary;
  readonly source_url: string;
  readonly followed: boolean;
}
/** A source like one the person follows, with its newest headlines. */
export interface SimilarSource extends SourceSuggestion {
  readonly stories: readonly {
    readonly id: number;
    readonly title: string | null;
  }[];
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

/** Longest conversation title, in characters. */
const TITLE_LENGTH = 50;

/** A conversation's title from its first question: cut at {@link TITLE_LENGTH} with an ellipsis. */
export function conversationTitle(question: string): string {
  const text = question.trim().replace(/\s+/g, ' ');
  return text.length > TITLE_LENGTH ? `${text.slice(0, TITLE_LENGTH)}…` : text;
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
        extra_sections: sql<
          string | null
        >`(select group_concat(${subscription_sections.section_id}) from ${subscription_sections} where ${subscription_sections.subscription_id} = ${subscriptions.id})`,
        custom_icon: subscriptions.custom_icon,
        auto_mark_read_days: subscriptions.auto_mark_read_days,
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

  async listFeeds(userId: number): Promise<Feed[]> {
    const rows = await this.#feeds()
      .where(eq(subscriptions.user_id, userId))
      .orderBy(
        asc(subscriptions.position),
        asc(subscriptions.created_at),
        asc(subscriptions.id),
      );
    return rows.map(feedOf);
  }

  /** The person's feed with this id, or undefined when it is not theirs. */
  async getFeed(userId: number, id: number): Promise<Feed | undefined> {
    const [row] = await this.#feeds()
      .where(and(eq(subscriptions.id, id), eq(subscriptions.user_id, userId)))
      .limit(1);
    return row && feedOf(row);
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
    return row && feedOf(row);
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
    if (changes.section_ids !== undefined) {
      set.section_id = changes.section_ids[0] ?? null;
    }
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
    if (changes.custom_icon !== undefined) {
      set.custom_icon = changes.custom_icon;
    }
    if (changes.auto_mark_read_days !== undefined) {
      set.auto_mark_read_days = changes.auto_mark_read_days;
    }
    if (
      (changes.section_ids !== undefined || changes.section_id !== undefined) &&
      (await this.getFeed(userId, id))
    ) {
      // A new set of sections replaces the old; a new print section alone
      // keeps the others, but not twice.
      const extra =
        changes.section_ids?.slice(1) ??
        (await this.getFeed(userId, id))!.section_ids.filter(
          (s, i) => i > 0 && s !== changes.section_id,
        );
      await this.#db
        .delete(subscription_sections)
        .where(eq(subscription_sections.subscription_id, id));
      for (const sectionId of new Set(extra)) {
        await this.#db
          .insert(subscription_sections)
          .values({ subscription_id: id, section_id: sectionId })
          .onConflictDoNothing();
      }
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
    if (removed.length) {
      await this.#db
        .delete(subscription_sections)
        .where(eq(subscription_sections.subscription_id, id));
    }
    return removed.length > 0;
  }

  /**
   * File several of the person's feeds under one section (null for none) at
   * once, as NewsBlur moves a selection of feeds into a folder. Their other
   * sections stay. The ids that were not theirs are skipped; the count says
   * how many moved.
   */
  async moveFeeds(
    userId: number,
    ids: readonly number[],
    sectionId: number | null,
  ): Promise<number> {
    let moved = 0;
    for (const id of new Set(ids)) {
      if (await this.getFeed(userId, id)) {
        await this.updateFeed(userId, id, { section_id: sectionId });
        moved++;
      }
    }
    return moved;
  }

  /**
   * Stop following several of the person's feeds at once. Returns how many
   * there were to remove.
   */
  async removeFeeds(userId: number, ids: readonly number[]): Promise<number> {
    let removed = 0;
    for (const id of new Set(ids)) {
      if (await this.removeFeed(userId, id)) removed++;
    }
    return removed;
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
    const { error, retryAfter, etag, lastModified, durationMs, nextFetch } =
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
              next_fetch_at:
                nextFetch === undefined
                  ? null
                  : sql`datetime('now', '+' || ${nextFetch} || ' minutes')`,
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
      duration_ms: durationMs ?? null,
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
   * The sources somebody follows that are due a fetch: never scheduled, or
   * due before the next five-minute run would see them.
   */
  async dueSources(): Promise<Source[]> {
    return (await this.allSources()).filter(
      (s) =>
        !s.next_fetch_at ||
        Date.parse(`${s.next_fetch_at.replace(' ', 'T')}Z`) <=
          Date.now() + DUE_SLACK_MS,
    );
  }

  /**
   * Point a source at the address its feed moved to for good, forgetting the
   * validators of the old one. When another source already has that address,
   * the two are merged instead: this source's followers follow that one. The
   * id of the source that now stands for the feed.
   */
  async moveSource(sourceId: number, url: string): Promise<number> {
    const taken = await this.#db.query.sources.findFirst({
      where: eq(sources.url, url),
    });
    if (taken && taken.id !== sourceId) {
      await this.mergeSource(sourceId, taken.id);
      return taken.id;
    }
    await this.#db
      .update(sources)
      .set({ url, etag: null, last_modified: null })
      .where(eq(sources.id, sourceId));
    return sourceId;
  }

  /**
   * Fold one source into another that turned out to be the same feed: each
   * follower of `from` follows `into` (keeping their own settings), unless they
   * already did. `from` keeps its stories and, followed by nobody, is no longer
   * fetched.
   */
  async mergeSource(from: number, into: number): Promise<void> {
    const already = this.#db
      .select({ user: subscriptions.user_id })
      .from(subscriptions)
      .where(eq(subscriptions.source_id, into));
    await this.#db.batch([
      this.#db
        .update(subscriptions)
        .set({ source_id: into })
        .where(
          and(
            eq(subscriptions.source_id, from),
            notInArray(subscriptions.user_id, already),
          ),
        ),
      this.#db.delete(subscriptions).where(eq(subscriptions.source_id, from)),
    ]);
  }

  /**
   * How busy a source is, for scheduling its next fetch: the distinct stories
   * it published in the last 30 days, how many follow it, and whole months
   * since its newest story.
   */
  async sourceActivity(sourceId: number): Promise<FeedActivity> {
    const published = sql`coalesce(nullif(${articles.published_at}, ''), ${articles.fetched_at})`;
    const [row] = await this.#db
      .select({
        recent: sql<number>`count(distinct case when julianday(${published}) >= julianday('now', '-30 days') then ${articles.url} end)`,
        newest: sql<number | null>`max(julianday(${published}))`,
        now: sql<number>`julianday('now')`,
      })
      .from(articles)
      .where(eq(articles.source_id, sourceId));
    const [followers] = await this.#db
      .select({ n: sql<number>`count(*)` })
      .from(subscriptions)
      .where(eq(subscriptions.source_id, sourceId));
    const days = row?.newest == null ? Infinity : row.now - row.newest;
    return {
      storiesLastMonth: row?.recent ?? 0,
      subscribers: followers?.n ?? 0,
      monthsSinceLastStory: Number.isFinite(days) ? Math.floor(days / 30) : 12,
    };
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
    if (Object.values(changes).some((v) => v !== undefined)) {
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
   * Remove a section. By default its feeds stay, filed under their other
   * sections or none, and the sections nested in it move up to its parent.
   * With `unfollowFeeds`, as NewsBlur deletes a folder, the sections nested in
   * it go too, and so does every feed filed only inside them; a feed also
   * filed elsewhere stays there. True when there was one to remove.
   */
  async removeSection(
    userId: number,
    id: number,
    unfollowFeeds = false,
  ): Promise<boolean> {
    const all = await this.listSections(userId);
    if (!all.some((s) => s.id === id)) return false;
    if (!unfollowFeeds) {
      await this.#dropSection(userId, id);
      return true;
    }
    const doomed = sectionAndDescendants(all, id);
    for (const feed of await this.listFeeds(userId)) {
      if (
        feed.section_ids.length &&
        feed.section_ids.every((s) => doomed.has(s))
      ) {
        await this.removeFeed(userId, feed.id);
      }
    }
    // Deepest first, so no section is lifted into one about to go.
    for (const section of all.filter((s) => doomed.has(s.id)).toReversed()) {
      await this.#dropSection(userId, section.id);
    }
    return true;
  }

  /**
   * Delete one section: the sections in it move up to its parent, feeds
   * printed under it move to their next section (or none), and the editions
   * that printed it stop naming it.
   */
  async #dropSection(userId: number, id: number): Promise<void> {
    const removed = await this.#db
      .delete(sections)
      .where(and(eq(sections.id, id), eq(sections.user_id, userId)))
      .returning({ parent_id: sections.parent_id });
    if (!removed.length) return;
    await this.#db
      .update(sections)
      .set({ parent_id: removed[0]!.parent_id })
      .where(and(eq(sections.user_id, userId), eq(sections.parent_id, id)));
    for (const feed of await this.listFeeds(userId)) {
      if (feed.section_ids.includes(id)) {
        await this.updateFeed(userId, feed.id, {
          section_ids: feed.section_ids.filter((s) => s !== id),
        });
      }
    }
    for (const edition of await this.listCustomEditions(userId)) {
      if (edition.section_ids.includes(id)) {
        await this.updateCustomEdition(userId, edition.id, {
          section_ids: edition.section_ids.filter((s) => s !== id),
        });
      }
    }
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
    const guids = JSON.stringify(
      items.flatMap((a) => (a.guid ? [a.guid] : [])),
    );
    const stale = this.#db.delete(articles).where(
      and(
        eq(articles.source_id, sourceId),
        eq(articles.edition, edition),
        sql`${articles.url} NOT IN (SELECT value FROM json_each(${listed}))`,
        // A story still listed by its id is renamed below, not dropped.
        sql`ifnull(${articles.guid}, '') NOT IN (SELECT value FROM json_each(${guids}))`,
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
        comments_url: a.comments_url || null,
        guid: a.guid || null,
        author: a.author || null,
        tags: JSON.stringify(a.tags ?? []),
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
            original_summary: sql`coalesce(${articles.original_summary}, case when ${articles.summary} is not excluded.summary then ${articles.summary} end)`,
          },
        });
    });
    // A story the feed still lists by its id under a new address keeps its row.
    const renames = items
      .filter((a) => a.guid)
      .map((a) =>
        this.#db
          .update(articles)
          .set({ url: a.url })
          .where(
            and(
              eq(articles.source_id, sourceId),
              eq(articles.edition, edition),
              eq(articles.guid, a.guid!),
              ne(articles.url, a.url),
              // Leave it when the new address already has its own row.
              sql`not exists (select 1 from articles as taken where taken.source_id = ${sourceId} and taken.edition = ${edition} and taken.url = ${a.url})`,
            ),
          ),
      );
    await this.#db.batch([stale, ...renames, ...upserts]);
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
      .where(and(eq(subscriptions.user_id, userId), notMuted))
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
    {
      q = '',
      before,
      feed,
      feeds,
      domain,
      from,
      to,
      oldest,
      limit,
    }: ArticleQuery,
  ): Promise<ArticleSummary[]> {
    const host = domain
      ?.trim()
      .toLowerCase()
      .replace(/^\.+|\.+$/g, '');
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
            ? oldest
              ? gt(articles.id, before)
              : lt(articles.id, before)
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
          feeds !== undefined
            ? inArray(
                articles.source_id,
                this.#db
                  .select({ id: subscriptions.source_id })
                  .from(subscriptions)
                  .where(
                    and(
                      inArray(subscriptions.id, [...feeds]),
                      eq(subscriptions.user_id, userId),
                    ),
                  ),
              )
            : undefined,
          host
            ? or(
                sql`lower(${articles.url}) like ${`%://${host}/%`}`,
                sql`lower(${articles.url}) like ${`%://${host}`}`,
                sql`lower(${articles.url}) like ${`%.${host}/%`}`,
              )
            : undefined,
          from !== undefined ? sql`${articles.edition} >= ${from}` : undefined,
          to !== undefined ? sql`${articles.edition} <= ${to}` : undefined,
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
  async setBodyText(id: number, text: string, image?: string): Promise<void> {
    await this.#db
      .update(articles)
      .set({ body_text: text, ...(image ? { image } : {}) })
      .where(eq(articles.id, id));
  }

  /**
   * Up to `limit` stories from the sources the person follows most like this
   * one, best first: those sharing the most words of its title (FTS5 rank),
   * never another copy of the same address (NewsBlur's more-like-this).
   */
  async similarArticles(
    userId: number,
    article: Pick<Article, 'id' | 'url' | 'title'>,
    limit: number,
  ): Promise<ArticleSummary[]> {
    const match = anyWordQuery(article.title ?? '');
    if (!match) return [];
    return this.#db
      .select(summaryColumns)
      .from(articles)
      .innerJoin(
        sql`(SELECT rowid AS hit, rank FROM articles_fts WHERE articles_fts MATCH ${match}) AS fts`,
        sql`fts.hit = ${articles.id}`,
      )
      .where(
        and(
          inArray(articles.source_id, this.#followed(userId)),
          ne(articles.url, article.url),
        ),
      )
      .orderBy(sql`fts.rank`, desc(articles.id))
      .limit(limit);
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
   * Train the paper. A classifier for the same kind, value and scope replaces
   * the score of the one already there; `created` says whether it is new.
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
        input.scope_feed_id === undefined
          ? isNull(classifiers.scope_feed_id)
          : eq(classifiers.scope_feed_id, input.scope_feed_id),
        input.scope_section_id === undefined
          ? isNull(classifiers.scope_section_id)
          : eq(classifiers.scope_section_id, input.scope_section_id),
        eq(classifiers.is_regex, input.is_regex ? 1 : 0),
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
    const { is_regex, ...rest } = input;
    const [row] = await this.#db
      .insert(classifiers)
      .values({ user_id: userId, ...rest, is_regex: is_regex ? 1 : 0 })
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
    const set = { tags: JSON.stringify(tags) };
    await this.#db
      .insert(saves)
      .values({ user_id: userId, article_id: articleId, ...set })
      .onConflictDoUpdate({
        target: [saves.user_id, saves.article_id],
        set,
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

  /**
   * The person's saved stories, newest save first, optionally only those with
   * one tag or from one source.
   */
  async listSaves(
    userId: number,
    tag?: string,
    sourceId?: number,
  ): Promise<SavedStory[]> {
    const rows = await this.#saved()
      .where(
        and(
          eq(saves.user_id, userId),
          tag === undefined
            ? undefined
            : sql`exists (select 1 from json_each(${saves.tags}) where json_each.value = ${tag})`,
          sourceId === undefined ? undefined : eq(articles.source_id, sourceId),
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
        notes: saves.notes,
        highlights: saves.highlights,
      })
      .from(saves)
      .innerJoin(articles, eq(saves.article_id, articles.id));
  }

  #story(row: {
    article: ArticleSummary;
    tags: string;
    saved_at: string | null;
    notes: string | null;
    highlights: string;
  }): SavedStory {
    return {
      article: row.article,
      tags: tagsOf(row.tags),
      saved_at: row.saved_at,
      notes: row.notes,
      highlights: tagsOf(row.highlights),
    };
  }

  /**
   * Set the note and highlights on a story the person saved (undefined keeps
   * what is there, null clears the note). Undefined when it is not saved.
   */
  async annotateSave(
    userId: number,
    articleId: number,
    notes: {
      readonly notes?: string | null;
      readonly highlights?: readonly string[];
    },
  ): Promise<SavedStory | undefined> {
    const set: Partial<typeof saves.$inferInsert> = {};
    if (notes.notes !== undefined) set.notes = notes.notes;
    if (notes.highlights !== undefined) {
      set.highlights = JSON.stringify(notes.highlights);
    }
    if (Object.keys(set).length) {
      await this.#db
        .update(saves)
        .set(set)
        .where(and(eq(saves.user_id, userId), eq(saves.article_id, articleId)));
    }
    return this.getSave(userId, articleId);
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
   * How many stories each followed source published in the editions of the
   * last 30 days, by subscription id (sources with none count 0).
   */
  async storiesPerMonth(userId: number): Promise<Map<number, number>> {
    const rows = await this.#db
      .select({
        feed_id: subscriptions.id,
        count: sql<number>`count(${articles.id})`,
      })
      .from(subscriptions)
      .leftJoin(
        articles,
        and(
          eq(articles.source_id, subscriptions.source_id),
          sql`${articles.edition} >= date('now', '-30 days')`,
        ),
      )
      .where(eq(subscriptions.user_id, userId))
      .groupBy(subscriptions.id);
    return new Map(rows.map((r) => [r.feed_id, Number(r.count)]));
  }

  /**
   * How many stories of each followed feed the person has not opened, by
   * subscription id, counting each story once however many editions carry it.
   */
  async unreadCounts(userId: number): Promise<Map<number, number>> {
    const rows = await this.#db
      .select({
        feed_id: subscriptions.id,
        count: sql<number>`count(distinct ${articles.url})`,
      })
      .from(subscriptions)
      .innerJoin(articles, eq(articles.source_id, subscriptions.source_id))
      .where(
        and(
          eq(subscriptions.user_id, userId),
          sql`not exists (select 1 from reads r join articles a on a.id = r.article_id where r.user_id = ${userId} and a.url = ${articles.url})`,
        ),
      )
      .groupBy(subscriptions.id);
    return new Map(rows.map((r) => [r.feed_id, Number(r.count)]));
  }

  /** How much of the person's archive there is, overall and per feed. */
  async archiveStats(userId: number): Promise<ArchiveStats> {
    const [feeds, perFeed, [totals], [saved], [read]] = await Promise.all([
      this.listFeeds(userId),
      this.#db
        .select({
          source_id: articles.source_id,
          count: sql<number>`count(*)`,
        })
        .from(articles)
        .where(inArray(articles.source_id, this.#followed(userId)))
        .groupBy(articles.source_id),
      this.#db
        .select({
          articles: sql<number>`count(*)`,
          editions: sql<number>`count(distinct ${articles.edition})`,
          oldest: sql<string | null>`min(${articles.edition})`,
          newest: sql<string | null>`max(${articles.edition})`,
        })
        .from(articles)
        .where(inArray(articles.source_id, this.#followed(userId))),
      this.#db
        .select({ count: sql<number>`count(*)` })
        .from(saves)
        .where(eq(saves.user_id, userId)),
      this.#db
        .select({ count: sql<number>`count(*)` })
        .from(reads)
        .where(eq(reads.user_id, userId)),
    ]);
    const counts = new Map(perFeed.map((r) => [r.source_id, Number(r.count)]));
    return {
      articles: Number(totals?.articles ?? 0),
      editions: Number(totals?.editions ?? 0),
      oldest_edition: totals?.oldest ?? null,
      newest_edition: totals?.newest ?? null,
      saved: Number(saved?.count ?? 0),
      read: Number(read?.count ?? 0),
      feeds: feeds
        .map((f) => ({
          feed_id: f.id,
          title: f.title ?? f.url,
          articles: counts.get(f.source_id) ?? 0,
        }))
        .sort((a, b) => b.articles - a.articles || a.feed_id - b.feed_id),
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
        archived: sql<number>`coalesce(sum(${articles.body_text} is not null), 0)`,
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
        duration_ms: h.duration_ms,
      })),
      next_fetch_at: source.next_fetch_at,
      archive_count: Number(totals?.archived ?? 0),
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
    return this.windowArticles(edition, edition);
  }

  /**
   * Every article of the editions from `from` to `to` (YYYY-MM-DD, both
   * included), from every source, for clustering across days.
   */
  windowArticles(from: string, to: string): Promise<Clusterable[]> {
    return this.#db
      .select({
        id: articles.id,
        source_id: articles.source_id,
        title: articles.title,
        summary: articles.summary,
        feed_title: sources.title,
      })
      .from(articles)
      .leftJoin(sources, eq(articles.source_id, sources.id))
      .where(and(gte(articles.edition, from), lte(articles.edition, to)))
      .orderBy(asc(articles.id));
  }

  /**
   * Replace one edition's clusters: each group of article ids becomes a
   * cluster its members point at, and every other article of the edition
   * belongs to none.
   */
  writeClusters(
    edition: string,
    groups: readonly (readonly number[])[],
  ): Promise<void> {
    return this.writeWindowClusters(edition, edition, groups);
  }

  /**
   * Replace the clusters of the editions from `from` to `to`: every article
   * of them leaves its cluster, those clusters go, and each group becomes a
   * new cluster dated `to`.
   */
  async writeWindowClusters(
    from: string,
    to: string,
    groups: readonly (readonly number[])[],
  ): Promise<void> {
    const window = and(gte(articles.edition, from), lte(articles.edition, to));
    await this.#db.batch([
      this.#db.update(articles).set({ cluster_id: null }).where(window),
      this.#db
        .delete(clusters)
        .where(and(gte(clusters.edition, from), lte(clusters.edition, to))),
    ]);
    for (const group of groups) {
      const [cluster] = await this.#db
        .insert(clusters)
        .values({ edition: to })
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

  /**
   * Forget the clusters dated before `before` (YYYY-MM-DD): their members
   * belong to none. Returns how many clusters went.
   */
  async expireClusters(before: string): Promise<number> {
    const old = this.#db
      .select({ id: clusters.id })
      .from(clusters)
      .where(lt(clusters.edition, before));
    await this.#db
      .update(articles)
      .set({ cluster_id: null })
      .where(inArray(articles.cluster_id, old));
    const gone = await this.#db
      .delete(clusters)
      .where(lt(clusters.edition, before))
      .returning({ id: clusters.id });
    return gone.length;
  }

  /**
   * The members of these clusters from sources the person follows, from any
   * edition: the copies a paper names though it does not print them.
   */
  async clusterMembers(
    userId: number,
    clusterIds: readonly number[],
  ): Promise<Article[]> {
    const rows: Article[] = [];
    for (const part of chunks([...new Set(clusterIds)], IN_CHUNK)) {
      rows.push(
        ...(await this.#db
          .select()
          .from(articles)
          .where(
            and(
              inArray(articles.cluster_id, part),
              inArray(articles.source_id, this.#followed(userId)),
            ),
          )),
      );
    }
    return rows;
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
    briefingStories: string | null = null,
  ): Promise<void> {
    await this.#db
      .insert(issues)
      .values({
        user_id: userId,
        date,
        layout,
        briefing,
        briefing_stories: briefingStories,
      })
      .onConflictDoUpdate({
        target: [issues.user_id, issues.date],
        set: {
          layout,
          briefing,
          briefing_stories: briefingStories,
          created_at: sql`(datetime('now'))`,
        },
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
    briefingStories: string | null = null,
  ): Promise<void> {
    await this.#db
      .insert(edition_issues)
      .values({
        edition_id: editionId,
        date,
        layout,
        briefing,
        briefing_stories: briefingStories,
      })
      .onConflictDoUpdate({
        target: [edition_issues.edition_id, edition_issues.date],
        set: {
          layout,
          briefing,
          briefing_stories: briefingStories,
          created_at: sql`(datetime('now'))`,
        },
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
   * A trending list of the articles from sources the person follows, as
   * NewsBlur serves its well read, long, good and most-saved lists: each
   * story is scored by `order` from the reads and saves since `since`, a
   * story counts only once {@link MIN_PEOPLE} people are behind it, the
   * ranked list is spread out by feed, site, publisher and topic, and it is
   * served from the top (or the end with `sort=oldest`). Only counts leave
   * here, never who. Returns the page after `after`, and one more when
   * another page follows.
   */
  async trendingArticles(
    userId: number,
    { order, since, after, unread, sort, limit }: TrendingQuery,
  ): Promise<TrendingArticle[]> {
    const text = sql`trim(coalesce(${articles.body_text}, ''))`;
    const words = sql<number>`(case when ${text} = '' then 0 else length(${text}) - length(replace(${text}, ' ', '')) + 1 end)`;
    const savers = sql<number>`(select count(*) from ${saves} where ${saves.article_id} = ${articles.id} and ${saves.created_at} >= ${since})`;
    const followers = sql<number>`(select count(*) from ${subscriptions} where ${subscriptions.source_id} = ${articles.source_id})`;
    const acts = order === 'saves' ? saves : reads;
    const rows = await this.#db
      .select({
        article: summaryColumns,
        words,
        savers,
        followers,
        seconds:
          order === 'saves'
            ? sql<string>`''`
            : sql<string>`group_concat(${reads.seconds})`,
        site: sources.site_url,
        feed: sources.url,
        publisher: sources.title,
      })
      .from(acts)
      .innerJoin(articles, eq(acts.article_id, articles.id))
      .innerJoin(sources, eq(sources.id, articles.source_id))
      .where(
        and(
          sql`${acts.created_at} >= ${since}`,
          inArray(articles.source_id, this.#followed(userId)),
          unread
            ? notInArray(
                articles.id,
                this.#db
                  .select({ id: reads.article_id })
                  .from(reads)
                  .where(eq(reads.user_id, userId)),
              )
            : undefined,
        ),
      )
      .groupBy(articles.id);
    const byId = new Map(rows.map((r) => [r.article.id, r]));
    const ranked = rows
      .flatMap((r) => {
        const seconds = r.seconds
          ? String(r.seconds).split(',').map(Number)
          : [];
        const scored = rank(order, {
          id: r.article.id,
          seconds,
          savers: Number(r.savers),
          words: Number(r.words),
        });
        return scored ? [scored] : [];
      })
      .toSorted(byRank)
      .slice(0, LIST_SIZE[order]);
    const candidates = ranked.map((scored) => {
      const r = byId.get(scored.id)!;
      return {
        ...scored,
        source: r.article.source_id,
        domain: domainOf(r.site || r.feed),
        publisher: titleKey(r.publisher ?? ''),
        topic: topicOf(r.article.title ?? ''),
        cluster: r.article.cluster_id,
        title: titleKey(r.article.title ?? ''),
        followers: Number(r.followers),
      };
    });
    const served = diversify(
      candidates,
      order === 'good_reads' ? SMALL_FEED_SLOTS : 0,
    );
    if (sort === 'oldest') served.reverse();
    let start = 0;
    if (after) {
      const at = served.findIndex((c) => c.id === after.id);
      start = (at >= 0 ? at : after.position) + 1;
    }
    return served.slice(start, start + limit + 1).map((c, i) => ({
      article: byId.get(c.id)!.article,
      count: c.count,
      position: start + i,
    }));
  }

  /**
   * The sources most read (or most newly followed) since `since`, across
   * everyone, most first, as NewsBlur's trending feeds. Reads rank by
   * distinct readers or seconds spent; follows by new followers, each counted
   * less the older it is, needing a weighted {@link MIN_FOLLOW_SCORE}. It
   * reaches past what the caller follows, so only sources at least
   * {@link MIN_PEOPLE} people follow and rank by show (a feed address one
   * person uses may be private to them), stale sources stay out, and only
   * counts leave here. Asks for one more than `limit`.
   */
  async trendingSources({
    order,
    since,
    freshSince,
    days,
    now,
    after,
    limit,
  }: SourceTrendingQuery): Promise<TrendingSource[]> {
    const followers = sql<number>`(select count(*) from ${subscriptions} where ${subscriptions.source_id} = ${sources.id})`;
    const fresh = sql`exists (select 1 from ${articles} where ${articles.source_id} = ${sources.id} and ${articles.edition} >= ${freshSince})`;
    const details = {
      id: sources.id,
      url: sources.url,
      title: sources.title,
      site_url: sources.site_url,
      followers,
    };
    const scored: { source: Omit<TrendingSource, 'count'>; count: number }[] =
      [];
    if (order === 'follows') {
      const rows = await this.#db
        .select({ ...details, at: subscriptions.created_at })
        .from(subscriptions)
        .innerJoin(sources, eq(sources.id, subscriptions.source_id))
        .where(and(sql`${subscriptions.created_at} >= ${since}`, fresh));
      const nowMs = Date.parse(`${now.replace(' ', 'T')}Z`);
      const bySource = new Map<number, (typeof scored)[number]>();
      for (const { at, ...source } of rows) {
        const ago = Math.floor(
          (nowMs - Date.parse(`${(at ?? now).replace(' ', 'T')}Z`)) /
            86_400_000,
        );
        const entry = bySource.get(source.id) ?? { source, count: 0 };
        entry.count += decayWeight(days, Math.max(0, ago));
        bySource.set(source.id, entry);
      }
      for (const entry of bySource.values()) {
        const count = Math.round(entry.count * 100) / 100;
        if (count >= MIN_FOLLOW_SCORE) scored.push({ ...entry, count });
      }
    } else {
      const timed = sql`${reads.seconds} >= ${MIN_READ_SECONDS}`;
      const rows = await this.#db
        .select({
          ...details,
          people:
            order === 'read_time'
              ? sql<number>`count(distinct case when ${timed} then ${reads.user_id} end)`
              : sql<number>`count(distinct ${reads.user_id})`,
          score:
            order === 'read_time'
              ? sql<number>`sum(case when ${timed} then min(${reads.seconds}, ${MAX_READ_SECONDS}) else 0 end)`
              : sql<number>`count(distinct ${reads.user_id})`,
        })
        .from(reads)
        .innerJoin(articles, eq(articles.id, reads.article_id))
        .innerJoin(sources, eq(sources.id, articles.source_id))
        .where(and(sql`${reads.created_at} >= ${since}`, fresh))
        .groupBy(sources.id);
      for (const { people, score, ...source } of rows) {
        if (Number(people) >= MIN_PEOPLE) {
          scored.push({ source, count: Number(score) });
        }
      }
    }
    return scored
      .filter(({ source }) => Number(source.followers) >= MIN_PEOPLE)
      .filter(
        ({ source, count }) =>
          !after ||
          count < after.count ||
          (count === after.count && source.id < after.id),
      )
      .toSorted((a, b) => b.count - a.count || b.source.id - a.source.id)
      .slice(0, limit + 1)
      .map(({ source, count }) => ({
        ...source,
        followers: Number(source.followers),
        count,
      }));
  }

  /**
   * Note how long the person spent on a story they read: the longest time
   * recorded wins, capped at {@link MAX_READ_SECONDS}. Undefined when they
   * have no read of it, else the seconds now stored.
   */
  async recordReadTime(
    userId: number,
    articleId: number,
    seconds: number,
  ): Promise<number | undefined> {
    const [row] = await this.#db
      .update(reads)
      .set({
        seconds: sql`max(${reads.seconds}, ${Math.min(seconds, MAX_READ_SECONDS)})`,
      })
      .where(and(eq(reads.user_id, userId), eq(reads.article_id, articleId)))
      .returning({ seconds: reads.seconds });
    return row?.seconds;
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

  /**
   * How many stories each of these sources published in editions from
   * `since` (YYYY-MM-DD) on, by source id; absent sources published none.
   */
  async sourceCounts(
    sourceIds: readonly number[],
    since: string,
  ): Promise<Map<number, number>> {
    const counts = new Map<number, number>();
    for (const part of chunks([...new Set(sourceIds)], IN_CHUNK)) {
      const rows = await this.#db
        .select({ id: articles.source_id, n: sql<number>`count(*)` })
        .from(articles)
        .where(
          and(inArray(articles.source_id, part), gte(articles.edition, since)),
        )
        .groupBy(articles.source_id);
      rows.forEach((r) => counts.set(r.id, Number(r.n)));
    }
    return counts;
  }

  /** The sources of the stories a person has read. */
  async readSourceIds(userId: number): Promise<Set<number>> {
    const rows = await this.#db
      .selectDistinct({ id: articles.source_id })
      .from(reads)
      .innerJoin(articles, eq(reads.article_id, articles.id))
      .where(eq(reads.user_id, userId));
    return new Set(rows.map((r) => r.id));
  }

  /**
   * Articles from the person's followed, unmuted sources fetched since
   * `since` (a SQLite time), newest first; with `sourceIds`, only from those
   * sources.
   */
  async briefingArticles(
    userId: number,
    since: string,
    sourceIds?: readonly number[],
  ): Promise<Article[]> {
    const feeds = (await this.listFeeds(userId)).filter(
      (f) =>
        !f.muted &&
        (sourceIds === undefined || sourceIds.includes(f.source_id)),
    );
    const rows: Article[] = [];
    for (const part of chunks(
      [...new Set(feeds.map((f) => f.source_id))],
      IN_CHUNK,
    )) {
      rows.push(
        ...(await this.#db
          .select()
          .from(articles)
          .where(
            and(
              inArray(articles.source_id, part),
              gte(articles.fetched_at, since),
            ),
          )),
      );
    }
    return rows.sort((a, b) => b.id - a.id);
  }

  /**
   * The person's articles fetched since `since` whose title, summary or text
   * holds every word of `q`, best match first, at most `limit`.
   */
  async searchSince(
    userId: number,
    q: string,
    since: string,
    limit = 10,
  ): Promise<Article[]> {
    const match = ftsQuery(q);
    if (!match) return [];
    return this.#db
      .select()
      .from(articles)
      .where(
        and(
          gte(articles.fetched_at, since),
          inArray(articles.source_id, this.#followed(userId)),
          sql`${articles.id} IN (SELECT rowid FROM articles_fts WHERE articles_fts MATCH ${match})`,
        ),
      )
      .orderBy(desc(articles.id))
      .limit(limit);
  }

  /**
   * The articles the most people read (saved, or shared) since `since`, across
   * everyone, most first, at most `limit`, with how many did. Only counts
   * leave the database, never who.
   */
  async popularArticles(
    order: 'reads' | 'saves' | 'shares',
    since: string,
    limit: number,
  ): Promise<{ readonly article: Article; readonly count: number }[]> {
    const acts = order === 'reads' ? reads : order === 'saves' ? saves : shares;
    const count = sql<number>`count(*)`;
    const rows = await this.#db
      .select({ article: getTableColumns(articles), count })
      .from(acts)
      .innerJoin(articles, eq(acts.article_id, articles.id))
      .where(sql`${acts.created_at} >= ${since}`)
      .groupBy(articles.id)
      .orderBy(desc(count), desc(articles.id))
      .limit(limit);
    return rows.map((r) => ({ article: r.article, count: Number(r.count) }));
  }

  /** Store a briefing, replacing the one for the same slot and day. */
  async saveBriefing(b: NewBriefing): Promise<StoredBriefing> {
    const { user_id, slot, local_date, ...rest } = b;
    const [row] = await this.#db
      .insert(briefings)
      .values(b)
      .onConflictDoUpdate({
        target: [briefings.user_id, briefings.slot, briefings.local_date],
        set: { ...rest, created_at: sql`(datetime('now'))` },
      })
      .returning();
    if (!row) throw new Error(`briefing ${user_id}/${slot}/${local_date}`);
    return row;
  }

  /** A person's briefing for a slot and day, if one was written. */
  findBriefing(
    userId: number,
    slot: string,
    localDate: string,
  ): Promise<StoredBriefing | undefined> {
    return this.#db.query.briefings.findFirst({
      where: and(
        eq(briefings.user_id, userId),
        eq(briefings.slot, slot),
        eq(briefings.local_date, localDate),
      ),
    });
  }

  /** One of a person's briefings by id. */
  getBriefing(userId: number, id: number): Promise<StoredBriefing | undefined> {
    return this.#db.query.briefings.findFirst({
      where: and(eq(briefings.user_id, userId), eq(briefings.id, id)),
    });
  }

  /**
   * Briefings newest first, at most `limit`, each with a smaller id than
   * `before` when given: one person's (`userId`), or everyone's.
   */
  listBriefings(
    userId: number | undefined,
    limit: number,
    before?: number,
  ): Promise<StoredBriefing[]> {
    const where = [
      ...(userId === undefined ? [] : [eq(briefings.user_id, userId)]),
      ...(before === undefined ? [] : [lt(briefings.id, before)]),
    ];
    return this.#db
      .select()
      .from(briefings)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(briefings.id))
      .limit(limit);
  }

  /**
   * The stories the person's briefings since `since` covered, leaving out
   * the one for `except` (a slot and local date) that is being written again.
   */
  async briefedSince(
    userId: number,
    since: string,
    except?: { readonly slot: string; readonly date: string },
  ): Promise<string[]> {
    const rows = await this.#db
      .select({
        stories: briefings.stories,
        slot: briefings.slot,
        date: briefings.local_date,
      })
      .from(briefings)
      .where(
        and(eq(briefings.user_id, userId), gte(briefings.created_at, since)),
      );
    return rows
      .filter(
        (r) => !(except && r.slot === except.slot && r.date === except.date),
      )
      .map((r) => r.stories);
  }

  /** A person's preferences, with the defaults for what they never set. */
  async getPreferences(userId: number): Promise<Preferences> {
    const row = await this.#db.query.preferences.findFirst({
      where: eq(preferences.user_id, userId),
    });
    if (!row) return DEFAULT_PREFERENCES;
    const d = DEFAULT_PREFERENCES;
    return {
      story_clustering: row.story_clustering === 1,
      cluster_mode: oneOf(row.cluster_mode, ['title', 'related'], 'related'),
      cluster_mark_read: row.cluster_mark_read === 1,
      cluster_preview_style: oneOf(
        row.cluster_preview_style,
        ['single_line', 'expanded'],
        'single_line',
      ),
      briefing_enabled: row.briefing_enabled === 1,
      briefing_story_count: row.briefing_story_count,
      briefing_length: oneOf(
        row.briefing_length,
        ['short', 'medium', 'detailed'],
        'medium',
      ),
      briefing_style: oneOf(
        row.briefing_style,
        ['editorial', 'bullets', 'headlines'],
        'bullets',
      ),
      briefing_read_filter: oneOf(
        row.briefing_read_filter,
        ['unread', 'focus'],
        'unread',
      ),
      briefing_frequency: oneOf(
        row.briefing_frequency,
        ['daily', 'twice_daily', 'thrice_daily', 'weekly'],
        'daily',
      ),
      briefing_time: row.briefing_time,
      briefing_day: row.briefing_day,
      timezone: row.timezone,
      briefing_sources: row.briefing_sources,
      briefing_include_read: row.briefing_include_read === 1,
      briefing_model: row.briefing_model,
      briefing_sections: storedJson(
        row.briefing_sections,
        d.briefing_sections,
        isSwitches,
      ),
      briefing_section_order: storedJson(
        row.briefing_section_order,
        d.briefing_section_order,
        isStringList,
      ),
      briefing_prompts: storedJson(
        row.briefing_prompts,
        d.briefing_prompts,
        isStringList,
      ),
      intelligence:
        row.intelligence === 'focus' || row.intelligence === 'all'
          ? row.intelligence
          : 'unread',
      mark_read_on_open: row.mark_read_on_open === 1,
      auto_mark_read_days: row.auto_mark_read_days,
      mark_read_on_scroll: row.mark_read_on_scroll === 1,
    };
  }

  /** Change some of a person's preferences; returns all of them. */
  async updatePreferences(
    userId: number,
    changes: Partial<Preferences>,
  ): Promise<Preferences> {
    const next = { ...(await this.getPreferences(userId)), ...changes };
    const row = {
      story_clustering: next.story_clustering ? 1 : 0,
      cluster_mode: next.cluster_mode,
      cluster_mark_read: next.cluster_mark_read ? 1 : 0,
      cluster_preview_style: next.cluster_preview_style,
      briefing_enabled: next.briefing_enabled ? 1 : 0,
      briefing_story_count: next.briefing_story_count,
      briefing_length: next.briefing_length,
      briefing_style: next.briefing_style,
      briefing_read_filter: next.briefing_read_filter,
      intelligence: next.intelligence,
      mark_read_on_open: next.mark_read_on_open ? 1 : 0,
      auto_mark_read_days: next.auto_mark_read_days,
      briefing_frequency: next.briefing_frequency,
      briefing_time: next.briefing_time,
      briefing_day: next.briefing_day,
      timezone: next.timezone,
      briefing_sources: next.briefing_sources,
      briefing_include_read: next.briefing_include_read ? 1 : 0,
      briefing_model: next.briefing_model,
      briefing_sections: JSON.stringify(next.briefing_sections),
      briefing_section_order:
        next.briefing_section_order === null
          ? null
          : JSON.stringify(next.briefing_section_order),
      briefing_prompts: JSON.stringify(next.briefing_prompts),
      mark_read_on_scroll: next.mark_read_on_scroll ? 1 : 0,
      updated_at: sql`(datetime('now'))`,
    };
    await this.#db
      .insert(preferences)
      .values({ user_id: userId, ...row })
      .onConflictDoUpdate({ target: preferences.user_id, set: row });
    return next;
  }

  /** The ids of everyone who changed a preference, with their preferences. */
  async allPreferences(): Promise<Map<number, Preferences>> {
    const rows = await this.#db
      .select({ id: preferences.user_id })
      .from(preferences);
    const out = new Map<number, Preferences>();
    for (const { id } of rows) out.set(id, await this.getPreferences(id));
    return out;
  }

  /**
   * The other members of an article's cluster that the person can read (from
   * sources they follow), or none when it belongs to no cluster.
   */
  async clusterSiblingIds(
    userId: number,
    articleId: number,
  ): Promise<number[]> {
    const article = await this.getArticle(userId, articleId);
    if (!article || article.cluster_id === null) return [];
    const rows = await this.#db
      .selectDistinct({ id: articles.id })
      .from(articles)
      .innerJoin(subscriptions, eq(articles.source_id, subscriptions.source_id))
      .where(
        and(
          eq(articles.cluster_id, article.cluster_id),
          eq(subscriptions.user_id, userId),
        ),
      );
    return rows.map((r) => r.id).filter((id) => id !== articleId);
  }

  /**
   * A person's stored issues, newest first: at most `limit`, each before the
   * date `before` when given.
   */
  listIssues(
    userId: number,
    limit: number,
    before?: string,
  ): Promise<IssueListing[]> {
    return this.#db
      .select({
        date: issues.date,
        briefing: issues.briefing,
        created_at: issues.created_at,
      })
      .from(issues)
      .where(
        before === undefined
          ? eq(issues.user_id, userId)
          : and(eq(issues.user_id, userId), lt(issues.date, before)),
      )
      .orderBy(desc(issues.date))
      .limit(limit);
  }

  /** Articles the person follows, saved or read: what the assistant may draw on. */
  #reachable(userId: number) {
    const mine = (table: typeof saves | typeof reads) =>
      this.#db
        .select({ id: table.article_id })
        .from(table)
        .where(eq(table.user_id, userId));
    return or(
      inArray(articles.source_id, this.#followed(userId)),
      inArray(articles.id, mine(saves)),
      inArray(articles.id, mine(reads)),
    );
  }

  /** The columns of a {@link Passage}. */
  #passageColumns() {
    return {
      id: articles.id,
      title: articles.title,
      source: articles.source,
      summary: articles.summary,
      text: sql<string>`substr(coalesce(${articles.body_text}, ''), 1, ${PASSAGE_LENGTH})`,
      date: sql<
        string | null
      >`substr(coalesce(nullif(${articles.published_at}, ''), ${articles.edition}), 1, 10)`,
    };
  }

  /** The day an article counts as, for date ranges. */
  #day() {
    return sql`substr(coalesce(nullif(${articles.published_at}, ''), ${articles.edition}), 1, 10)`;
  }

  /**
   * The articles a person may ask the assistant about (from sources they
   * follow, or ones they saved or read) that hold any word of `question`,
   * best match first, as passages, narrowed by `query`.
   */
  async retrievePassages(
    userId: number,
    question: string,
    { since, until, source, limit = 6 }: PassageQuery = {},
  ): Promise<Passage[]> {
    const match = anyWordQuery(question);
    if (!match) return [];
    return this.#db
      .select(this.#passageColumns())
      .from(articles)
      .innerJoin(sql`articles_fts f`, sql`f.rowid = ${articles.id}`)
      .where(
        and(
          sql`articles_fts MATCH ${match}`,
          this.#reachable(userId),
          since ? sql`${this.#day()} >= ${since}` : undefined,
          until ? sql`${this.#day()} <= ${until}` : undefined,
          source
            ? sql`(${articles.source} LIKE ${`%${source}%`} OR ${articles.url} LIKE ${`%${source}%`})`
            : undefined,
        ),
      )
      .orderBy(sql`f.rank`, desc(articles.id))
      .limit(limit);
  }

  /** The person's saved stories, newest save first, with `tag` and holding any word of `query`. */
  async savedPassages(
    userId: number,
    {
      query = '',
      tag,
      limit = 10,
    }: { query?: string; tag?: string; limit?: number },
  ): Promise<Passage[]> {
    const match = anyWordQuery(query);
    return this.#db
      .select(this.#passageColumns())
      .from(saves)
      .innerJoin(articles, eq(saves.article_id, articles.id))
      .where(
        and(
          eq(saves.user_id, userId),
          tag === undefined
            ? undefined
            : sql`exists (select 1 from json_each(${saves.tags}) where json_each.value = ${tag})`,
          match
            ? sql`${articles.id} IN (SELECT rowid FROM articles_fts WHERE articles_fts MATCH ${match})`
            : undefined,
        ),
      )
      .orderBy(desc(saves.created_at), desc(saves.article_id))
      .limit(limit);
  }

  /** The stories the person opened in the last `days` days, newest first. */
  async recentReadPassages(
    userId: number,
    days: number,
    limit = 10,
  ): Promise<Passage[]> {
    return this.#db
      .select(this.#passageColumns())
      .from(reads)
      .innerJoin(articles, eq(reads.article_id, articles.id))
      .where(
        and(
          eq(reads.user_id, userId),
          sql`${reads.created_at} >= datetime('now', ${`-${days} days`})`,
        ),
      )
      .orderBy(desc(reads.created_at), desc(reads.article_id))
      .limit(limit);
  }

  /** One article with its text, if the person follows its source, saved or read it. */
  async reachableArticle(
    userId: number,
    id: number,
  ): Promise<Article | undefined> {
    const [row] = await this.#db
      .select()
      .from(articles)
      .where(and(eq(articles.id, id), this.#reachable(userId)))
      .limit(1);
    return row;
  }

  /** Counts of what the person's archive holds, with their busiest sources and tags. */
  async archiveSummary(userId: number): Promise<ArchiveSummary> {
    const count = sql<number>`count(*)`;
    const [followed] = await this.#db
      .select({ n: count })
      .from(subscriptions)
      .where(eq(subscriptions.user_id, userId));
    const [stories] = await this.#db
      .select({ n: count })
      .from(articles)
      .where(inArray(articles.source_id, this.#followed(userId)));
    const [saved] = await this.#db
      .select({ n: count })
      .from(saves)
      .where(eq(saves.user_id, userId));
    const [read] = await this.#db
      .select({ n: count })
      .from(reads)
      .where(eq(reads.user_id, userId));
    const top = await this.#db
      .select({ source: articles.source, count })
      .from(reads)
      .innerJoin(articles, eq(reads.article_id, articles.id))
      .where(
        and(
          eq(reads.user_id, userId),
          sql`coalesce(${articles.source}, '') <> ''`,
        ),
      )
      .groupBy(articles.source)
      .orderBy(desc(count), asc(articles.source))
      .limit(5);
    const tags = await this.#db
      .select({ tag: sql<string>`json_each.value`, count })
      .from(saves)
      .innerJoin(sql`json_each(${saves.tags})`, sql`1 = 1`)
      .where(eq(saves.user_id, userId))
      .groupBy(sql`json_each.value`)
      .orderBy(desc(count), asc(sql`json_each.value`))
      .limit(10);
    return {
      sources: Number(followed?.n ?? 0),
      articles: Number(stories?.n ?? 0),
      saves: Number(saved?.n ?? 0),
      reads: Number(read?.n ?? 0),
      top_sources: top.map((r) => ({
        source: r.source ?? '',
        count: Number(r.count),
      })),
      tags: tags.map((r) => ({ tag: String(r.tag), count: Number(r.count) })),
    };
  }

  /** A preset answer the person was given about an article before, if any. */
  async cachedAnswer(
    userId: number,
    articleId: number,
    questionId: string,
  ): Promise<string | undefined> {
    const [row] = await this.#db
      .select({ answer: answers.answer })
      .from(answers)
      .where(
        and(
          eq(answers.user_id, userId),
          eq(answers.article_id, articleId),
          eq(answers.question_id, questionId),
        ),
      )
      .limit(1);
    return row?.answer;
  }

  /** Keep a preset answer, replacing any kept before. */
  async storeAnswer(
    userId: number,
    articleId: number,
    questionId: string,
    answer: string,
  ): Promise<void> {
    await this.#db
      .insert(answers)
      .values({
        user_id: userId,
        article_id: articleId,
        question_id: questionId,
        answer,
      })
      .onConflictDoUpdate({
        target: [answers.user_id, answers.article_id, answers.question_id],
        set: { answer, created_at: sql`datetime('now')` },
      });
  }

  /** Note one question asked of the model; a cached answer is noted but not counted. */
  async recordUsage(
    userId: number,
    kind: UsageKind,
    cached = false,
  ): Promise<void> {
    await this.#db
      .insert(ai_usage)
      .values({ user_id: userId, kind, cached: cached ? 1 : 0 });
  }

  /** How many questions of `kind` the person asked of the model since `since` (stored time). */
  async usageSince(
    userId: number,
    kind: UsageKind,
    since: string,
  ): Promise<number> {
    const [row] = await this.#db
      .select({ n: sql<number>`count(*)` })
      .from(ai_usage)
      .where(
        and(
          eq(ai_usage.user_id, userId),
          eq(ai_usage.kind, kind),
          eq(ai_usage.cached, 0),
          sql`${ai_usage.created_at} >= ${since}`,
        ),
      );
    return Number(row?.n ?? 0);
  }

  /** The person's conversations, last active first. */
  listConversations(userId: number): Promise<ConversationSummary[]> {
    return this.#db
      .select()
      .from(conversations)
      .where(eq(conversations.user_id, userId))
      .orderBy(
        desc(
          sql`coalesce(${conversations.updated_at}, ${conversations.created_at})`,
        ),
        desc(conversations.id),
      );
  }

  /** Note a new turn: the conversation is active now, and titled by its first question. */
  async touchConversation(id: number, question: string): Promise<void> {
    await this.#db
      .update(conversations)
      .set({
        updated_at: sql`datetime('now')`,
        title: sql`coalesce(${conversations.title}, ${conversationTitle(question)})`,
      })
      .where(eq(conversations.id, id));
  }

  /** Remove the person's conversation and its turns. True when there was one. */
  async removeConversation(userId: number, id: number): Promise<boolean> {
    const removed = await this.#db
      .delete(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.user_id, userId)))
      .returning({ id: conversations.id });
    if (!removed.length) return false;
    await this.#db.delete(messages).where(eq(messages.conversation_id, id));
    return true;
  }

  /**
   * Sources that people who follow the source of the person's feed `feedId`
   * also follow, and the person does not, most shared first, each with its
   * newest headlines. Undefined when the feed is not theirs.
   */
  async similarSources(
    userId: number,
    feedId: number,
    limit = 5,
  ): Promise<SimilarSource[] | undefined> {
    const feed = await this.getFeed(userId, feedId);
    if (!feed) return undefined;
    const peer = alias(subscriptions, 'peer');
    const rows = await this.#db
      .select({
        id: sources.id,
        url: sources.url,
        title: sources.title,
        followers: sql<number>`count(distinct ${subscriptions.user_id})`,
      })
      .from(peer)
      .innerJoin(subscriptions, eq(subscriptions.user_id, peer.user_id))
      .innerJoin(sources, eq(sources.id, subscriptions.source_id))
      .where(
        and(
          eq(peer.source_id, feed.source_id),
          ne(peer.user_id, userId),
          notInArray(subscriptions.source_id, this.#followed(userId)),
        ),
      )
      .groupBy(sources.id)
      .orderBy(
        sql`count(distinct ${subscriptions.user_id}) desc`,
        asc(sources.id),
      )
      .limit(limit);
    return Promise.all(
      rows.map(async (r) => ({
        ...r,
        followers: Number(r.followers),
        stories: await this.#db
          .select({ id: articles.id, title: articles.title })
          .from(articles)
          .where(eq(articles.source_id, r.id))
          .orderBy(desc(articles.id))
          .limit(5),
      })),
    );
  }

  /**
   * NewsBlur's discover: stories from any source that share words with the title of the article
   * `articleId` (one the person can reach), best match first, leaving out the
   * article itself and other copies of its address. Undefined when the person
   * cannot reach it.
   */
  async discoverArticles(
    userId: number,
    articleId: number,
    limit = 5,
  ): Promise<DiscoveredArticle[] | undefined> {
    const article = await this.reachableArticle(userId, articleId);
    if (!article) return undefined;
    const match = anyWordQuery(`${article.title ?? ''}`);
    if (!match) return [];
    const followed = new Set((await this.#followed(userId)).map((r) => r.id));
    const rows = await this.#db
      .select({ article: summaryColumns, source_url: sources.url })
      .from(articles)
      .innerJoin(sources, eq(sources.id, articles.source_id))
      .innerJoin(sql`articles_fts f`, sql`f.rowid = ${articles.id}`)
      .where(
        and(sql`articles_fts MATCH ${match}`, ne(articles.url, article.url)),
      )
      .orderBy(sql`f.rank`, desc(articles.id))
      .limit(limit * 3);
    const seen = new Set<string>();
    return rows
      .filter((r) => !seen.has(r.article.url) && seen.add(r.article.url))
      .slice(0, limit)
      .map((r) => ({ ...r, followed: followed.has(r.article.source_id) }));
  }

  /** The tags on the person's saves, each with how many saves carry it. */
  async savedTagCounts(userId: number): Promise<TagCount[]> {
    const rows = await this.#db
      .select({ tags: saves.tags })
      .from(saves)
      .where(eq(saves.user_id, userId));
    const counts = new Map<string, number>();
    for (const row of rows) {
      for (const tag of tagsOf(row.tags)) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return [...counts]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => a.tag.localeCompare(b.tag));
  }

  /**
   * How many of the person's saves came from each source. A story whose
   * source they no longer follow is counted under it all the same.
   */
  async savedSourceCounts(
    userId: number,
  ): Promise<{ readonly source_id: number; readonly count: number }[]> {
    const rows = await this.#db
      .select({ source_id: articles.source_id, count: sql<number>`count(*)` })
      .from(saves)
      .innerJoin(articles, eq(saves.article_id, articles.id))
      .where(eq(saves.user_id, userId))
      .groupBy(articles.source_id)
      .orderBy(asc(articles.source_id));
    return rows;
  }

  /**
   * Rename a tag on every save carrying it, merging with `to` where a save
   * has both, or remove it from them when `to` is undefined. The number of
   * saves changed: 0 when no save had the tag.
   */
  async retagSaves(
    userId: number,
    from: string,
    to: string | undefined,
  ): Promise<number> {
    const rows = await this.#db
      .select({ article_id: saves.article_id, tags: saves.tags })
      .from(saves)
      .where(
        and(
          eq(saves.user_id, userId),
          sql`exists (select 1 from json_each(${saves.tags}) where json_each.value = ${from})`,
        ),
      );
    const updates = rows.map((row) => {
      const tags = tagsOf(row.tags).flatMap((t) =>
        t === from ? (to === undefined ? [] : [to]) : [t],
      );
      return this.#db
        .update(saves)
        .set({ tags: JSON.stringify([...new Set(tags)]) })
        .where(
          and(eq(saves.user_id, userId), eq(saves.article_id, row.article_id)),
        );
    });
    const [first, ...rest] = updates;
    if (first) await this.#db.batch([first, ...rest]);
    return rows.length;
  }

  /**
   * Mark the person's unread stories read, as NewsBlur's mark-all, mark-feed
   * and mark-stories read: all of their feeds or only some sources, only some
   * stories, one edition, and only those published before or after a time.
   * The ids now read: those it marked, and any of the named `articleIds`
   * that were read already (ids not in the person's feeds are left out).
   */
  async markAllRead(userId: number, scope: ReadScope = {}): Promise<number[]> {
    const rows = await this.#db
      .select({
        id: articles.id,
        published_at: articles.published_at,
        fetched_at: articles.fetched_at,
        read: sql<number>`exists (select 1 from ${reads} where ${reads.user_id} = ${userId} and ${reads.article_id} = ${articles.id})`,
      })
      .from(articles)
      .where(
        and(
          inArray(articles.source_id, this.#followed(userId)),
          scope.sourceIds === undefined
            ? undefined
            : inArray(articles.source_id, [...scope.sourceIds]),
          scope.articleIds === undefined
            ? undefined
            : inArray(articles.id, [...scope.articleIds]),
          scope.edition === undefined
            ? undefined
            : eq(articles.edition, scope.edition),
        ),
      )
      .orderBy(asc(articles.id));
    const inScope = rows.filter((a) => {
      if (!scope.before && !scope.after) return true;
      const at = storyTime(a);
      if (Number.isNaN(at)) return false;
      return (
        (!scope.before || at < scope.before.getTime()) &&
        (!scope.after || at > scope.after.getTime())
      );
    });
    const unread = inScope.filter((a) => !a.read);
    // Thirty rows per INSERT keeps under D1's limit on bound variables.
    const inserts = [];
    for (let i = 0; i < unread.length; i += 30) {
      inserts.push(
        this.#db
          .insert(reads)
          .values(
            unread
              .slice(i, i + 30)
              .map((a) => ({ user_id: userId, article_id: a.id })),
          )
          .onConflictDoNothing(),
      );
    }
    const [first, ...rest] = inserts;
    if (first) await this.#db.batch([first, ...rest]);
    return (scope.articleIds ? inScope : unread).map((a) => a.id);
  }

  /**
   * The stories of an edition in the person's feeds that a `prompt` classifier
   * has not been asked about yet, at most `limit`, for each such classifier.
   */
  async unscoredPrompts(
    userId: number,
    edition: string,
    limit: number,
  ): Promise<
    { readonly classifier: Classifier; readonly stories: ArticleSummary[] }[]
  > {
    const prompts = (await this.listClassifiers(userId)).filter(
      (c) => c.kind === 'prompt',
    );
    return Promise.all(
      prompts.map(async (classifier) => ({
        classifier,
        stories: await this.#db
          .select(summaryColumns)
          .from(articles)
          .where(
            and(
              inArray(articles.source_id, this.#followed(userId)),
              eq(articles.edition, edition),
              notInArray(
                articles.id,
                this.#db
                  .select({ id: prompt_scores.article_id })
                  .from(prompt_scores)
                  .where(eq(prompt_scores.classifier_id, classifier.id)),
              ),
            ),
          )
          .orderBy(asc(articles.id))
          .limit(limit),
      })),
    );
  }

  /** Keep the AI's answers for one prompt classifier, one row per story. */
  async savePromptScores(
    userId: number,
    classifierId: number,
    answers: ReadonlyMap<number, boolean>,
  ): Promise<void> {
    const inserts = [...answers].map(([articleId, matched]) =>
      this.#db
        .insert(prompt_scores)
        .values({
          classifier_id: classifierId,
          article_id: articleId,
          user_id: userId,
          matched: matched ? 1 : 0,
        })
        .onConflictDoNothing(),
    );
    const [first, ...rest] = inserts;
    if (first) await this.#db.batch([first, ...rest]);
  }

  /** The person's prompt classifiers each story matched, by article id. */
  async promptMatches(userId: number): Promise<Map<number, Set<number>>> {
    const rows = await this.#db
      .select({
        article_id: prompt_scores.article_id,
        classifier_id: prompt_scores.classifier_id,
      })
      .from(prompt_scores)
      .where(
        and(eq(prompt_scores.user_id, userId), eq(prompt_scores.matched, 1)),
      );
    const out = new Map<number, Set<number>>();
    for (const r of rows) {
      out.set(
        r.article_id,
        (out.get(r.article_id) ?? new Set()).add(r.classifier_id),
      );
    }
    return out;
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

/**
 * The names of a section and the sections it is in, outermost first. A loop
 * stops where it comes back round.
 */
export function sectionNames(all: readonly Section[], id: number): string[] {
  const byId = new Map(all.map((s) => [s.id, s]));
  const names: string[] = [];
  const seen = new Set<number>();
  for (let at = byId.get(id); at && !seen.has(at.id);) {
    seen.add(at.id);
    names.unshift(at.name);
    at = at.parent_id === null ? undefined : byId.get(at.parent_id);
  }
  return names;
}

/** A section's heading: its name after the names of the sections it is in. */
export function sectionPath(all: readonly Section[], id: number): string {
  return sectionNames(all, id).join(' · ');
}

/**
 * The SQL condition that a subscription is in the paper: not muted, or muted
 * for a time that has run out.
 */
export const notMuted = sql`(${subscriptions.muted} = 0 or (${subscriptions.muted_until} is not null and ${subscriptions.muted_until} <= datetime('now')))`;

/** A feed row as the repository selects it, before its sections are listed. */
type FeedRow = Omit<Feed, 'section_ids'> & {
  readonly extra_sections: string | null;
};

/** A selected feed row as a {@link Feed}: the print section, then the rest. */
function feedOf({ extra_sections: extra, ...row }: FeedRow): Feed {
  const others = (extra ?? '')
    .split(',')
    .filter(Boolean)
    .map(Number)
    .filter((s) => s !== row.section_id)
    .toSorted((a, b) => a - b);
  return {
    ...row,
    section_ids: row.section_id === null ? others : [row.section_id, ...others],
  };
}

/** Whether the feed is filed in any of these sections. */
export function filedIn(feed: Feed, ids: ReadonlySet<number>): boolean {
  return feed.section_ids.some((s) => ids.has(s));
}

/**
 * After how many days the feed's stories count as read, or undefined for
 * never: its own setting, else that of the section it prints under or the
 * nearest one above it that has one, else the person's own (`person`). 0 at
 * any level means never.
 */
export function autoMarkReadDays(
  feed: Feed,
  all: readonly Section[],
  person = 0,
): number | undefined {
  if (feed.auto_mark_read_days !== null) {
    return feed.auto_mark_read_days || undefined;
  }
  const byId = new Map(all.map((s) => [s.id, s]));
  const seen = new Set<number>();
  for (
    let at = feed.section_id === null ? undefined : byId.get(feed.section_id);
    at && !seen.has(at.id);
    at = at.parent_id === null ? undefined : byId.get(at.parent_id)
  ) {
    seen.add(at.id);
    if (at.auto_mark_read_days !== null)
      return at.auto_mark_read_days || undefined;
  }
  return person || undefined;
}
