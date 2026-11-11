/**
 * @packageDocumentation
 *
 * The tools the MCP server offers. Each runs as the person the access token
 * belongs to and calls the same repository and wire shapes the REST API
 * does, so an assistant sees what `/api` would send. Every query is scoped to
 * `ctx.uid`.
 */

import { z } from 'zod';

import {
  articleDetailResource,
  articleResource,
  MAX_QUERY_LENGTH,
  sqliteSince,
  trendingArticleResource,
  WINDOWS,
} from '@/domain/api/article-resource';
import {
  classifierResource,
  parseClassifierInput,
} from '@/domain/api/classifier-resource';
import {
  feedResource,
  parseFeedInput,
  parseFeedChanges,
} from '@/domain/api/feed-resource';
import { parseSaveInput, saveResource } from '@/domain/api/save-resource';
import {
  sectionResource,
  parseSectionInput,
} from '@/domain/api/section-resource';
import type { Database } from '@/domain/db/database';
import { feedClassifierCounts } from '@/domain/classifier-counts';
import { rank, verdict } from '@/domain/render/tiers';
import {
  Repository,
  sectionPath,
  TRENDING_ORDERS,
  type ArticleSummary,
  type Section,
} from '@/domain/repository';
import { refreshSource, todayEdition } from '@/domain/scraping/index';
import { messageResource } from '@/domain/api/conversation-resource';
import { issueResource } from '@/domain/api/issue-resource';
import { MAX_SUGGESTIONS, suggestionResource } from '@/domain/api/suggestions';
import {
  AnswerUnavailable,
  MAX_QUESTION_LENGTH,
  type AnswerModel,
} from '@/domain/assistant';
import { answerTurn } from '@/domain/assistant-tools';
import { budget } from '@/domain/api/usage';
import { issueFor, isIssueDate } from '@/domain/issues';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_FILTERS,
  NotificationRepository,
} from '@/domain/notifications';
import {
  notificationResource,
  parseNotificationInput,
} from '@/domain/api/notification-resource';
import { ShareRepository, type SharedStory } from '@/domain/shares';
import { TOPICS } from '@/domain/topics';
import { tool, ToolFailure, type McpTool } from '@/lib/mcp';

/** Who is calling and what the tools reach out to. */
export interface ToolContext {
  readonly uid: number;
  readonly db: Database;
  /** Fetch a newly followed feed after the reply is sent. */
  readonly refresh: (source: {
    readonly id: number;
    readonly url: string;
  }) => void;
  /** The model that answers archive questions, when one is bound. */
  readonly model?: AnswerModel;
}

/** The production way to fetch a newly followed feed. */
export function refresher(
  db: Database,
  env: CloudflareEnv,
  background: (work: Promise<unknown>) => void,
): ToolContext['refresh'] {
  return (source) =>
    background(refreshSource(db, env, source).catch(() => undefined));
}

/** A positive whole-number id. */
const id = (what: string) =>
  z.number().int().positive().describe(`The ${what}'s id.`);

/** The checked body of a REST input parser, or a failure naming its errors. */
function checked<T>(
  result:
    | ({ readonly ok: true } & T)
    | { readonly ok: false; readonly errors: readonly string[] },
): T {
  if (!result.ok) throw new ToolFailure(result.errors.join(' '));
  return result;
}

/** The most stories `search_articles` returns at once. */
const MAX_SEARCH = 50;

/** A calendar day written YYYY-MM-DD. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(isIssueDate, 'not a calendar date');

/** How many rows one search fetches while filtering. */
const BATCH = 100;

/** The most batches one search reads while filtering. */
const MAX_BATCHES = 10;

/**
 * Page through `fetch` (which returns one more row than asked for) until
 * `limit` rows pass `keep` or the rows run out. `next` is the id to continue
 * from when more may follow.
 */
export async function collect<T extends { readonly id: number }>(
  fetch: (before: number | undefined, limit: number) => Promise<T[]>,
  keep: (row: T) => boolean,
  limit: number,
  start?: number,
): Promise<{ readonly items: T[]; readonly next?: number }> {
  const items: T[] = [];
  let before = start;
  for (let batch = 0; batch < MAX_BATCHES; batch++) {
    const rows = await fetch(before, BATCH);
    const page = rows.slice(0, BATCH);
    for (const row of page) {
      if (keep(row)) items.push(row);
      before = row.id;
      if (items.length === limit) {
        const more = row !== page.at(-1) || rows.length > BATCH;
        return more ? { items, next: row.id } : { items };
      }
    }
    if (rows.length <= BATCH) return { items };
  }
  return before !== undefined ? { items, next: before } : { items };
}

/** A section and every section nested under it, by id. */
function sectionTree(sections: readonly Section[], root: number): Set<number> {
  const tree = new Set([root]);
  for (let grew = true; grew;) {
    grew = false;
    for (const s of sections) {
      if (s.parent_id !== null && tree.has(s.parent_id) && !tree.has(s.id)) {
        tree.add(s.id);
        grew = true;
      }
    }
  }
  return tree;
}

/**
 * The subscription ids a story listing is narrowed to (a feed, several, a
 * section), or undefined for every feed. Each named feed and section must be
 * the caller's.
 */
async function feedScope(
  repo: Repository,
  uid: number,
  scope: {
    readonly feed_id?: number;
    readonly feed_ids?: readonly number[];
    readonly section_id?: number;
  },
): Promise<number[] | undefined> {
  if (
    scope.feed_id === undefined &&
    scope.feed_ids === undefined &&
    scope.section_id === undefined
  ) {
    return undefined;
  }
  const [feeds, sections] = await Promise.all([
    repo.listFeeds(uid),
    repo.listSections(uid),
  ]);
  const mine = new Set(feeds.map((f) => f.id));
  const named = [
    ...(scope.feed_id !== undefined ? [scope.feed_id] : []),
    ...(scope.feed_ids ?? []),
  ];
  if (named.some((f) => !mine.has(f))) {
    throw new ToolFailure('There is no such feed.');
  }
  let ids = named.length ? named : [...mine];
  if (scope.section_id !== undefined) {
    if (!sections.some((s) => s.id === scope.section_id)) {
      throw new ToolFailure('There is no such section.');
    }
    const tree = sectionTree(sections, scope.section_id);
    const inTree = new Set(
      feeds
        .filter((f) => f.section_id !== null && tree.has(f.section_id))
        .map((f) => f.id),
    );
    ids = ids.filter((f) => inTree.has(f));
  }
  return ids;
}

/** A shared story as the tools show it: never the sharer's email. */
function shareResource(share: SharedStory): Record<string, unknown> {
  return {
    share_id: String(share.id),
    article: articleResource(share.article),
    ...(share.comments ? { comments: share.comments } : {}),
    ...(share.shared_at ? { shared_at: share.shared_at } : {}),
    sharer: {
      id: String(share.sharer.id),
      ...(share.sharer.name ? { name: share.sharer.name } : {}),
    },
  };
}

/** The classifier kinds `train_classifier` takes lists of. */
const TRAINABLE = ['title', 'author', 'tag', 'text'] as const;

/** The longest note or highlight on a save. */
const MAX_NOTE = 5000;

/** The most highlights on one save. */
const MAX_HIGHLIGHTS = 50;

/** The most stories `mark_read` marks at once. */
const MAX_MARK = 500;

/** An object without its undefined members, for the REST parsers. */
function dropUndefined(
  value: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  );
}

/** Every tool, in the order `tools/list` shows them. */
export const TOOLS: readonly McpTool<ToolContext>[] = [
  tool({
    name: 'list_feeds',
    title: 'List feeds and sections',
    description:
      'List the feeds the person follows and the sections (nested folders) they are filed under, each section with its feed ids. With include_counts, each feed also carries its unread stories and stories in the last 30 days.',
    input: z.object({
      include_counts: z
        .boolean()
        .default(false)
        .describe(
          'Add unread and monthly story counts to each feed and section.',
        ),
    }),
    readOnly: true,
    run: async ({ include_counts }, { uid, db }) => {
      const repo = new Repository(db);
      const [feeds, sections, unread, monthly] = await Promise.all([
        repo.listFeeds(uid),
        repo.listSections(uid),
        include_counts ? repo.unreadCounts(uid) : undefined,
        include_counts ? repo.storiesPerMonth(uid) : undefined,
      ]);
      // The full header of every feed is long; get_feed has it for one.
      return {
        feeds: feeds.map((feed) => ({
          ...Object.fromEntries(
            Object.entries(feedResource(feed)).filter(
              ([key]) => key !== 'metadata',
            ),
          ),
          ...(unread
            ? {
                unread: unread.get(feed.id) ?? 0,
                stories_per_month: monthly?.get(feed.id) ?? 0,
              }
            : {}),
        })),
        sections: sections.map((section) => {
          const ids = feeds
            .filter((f) => f.section_id === section.id)
            .map((f) => f.id);
          return {
            ...sectionResource(section),
            feed_ids: ids.map(String),
            ...(unread
              ? {
                  unread: ids.reduce((n, f) => n + (unread.get(f) ?? 0), 0),
                }
              : {}),
          };
        }),
      };
    },
  }),
  tool({
    name: 'get_feed',
    title: 'Get a feed',
    description:
      'Get one followed feed with its details (site, description, icon, every element of its header) and how its fetching is doing.',
    input: z.object({ feed_id: id('feed') }),
    readOnly: true,
    run: async ({ feed_id }, { uid, db }) => {
      const repo = new Repository(db);
      const feed = await repo.getFeed(uid, feed_id);
      if (!feed) throw new ToolFailure('There is no such feed.');
      const [stats, counts] = await Promise.all([
        repo.feedStatistics(uid, feed_id),
        feedClassifierCounts(repo, uid, feed),
      ]);
      return {
        feed: feedResource(feed),
        ...(stats
          ? {
              statistics: {
                fail_count: stats.fail_count,
                stories_per_day: stats.stories_per_day,
                classifier_counts: counts,
                ...(stats.last_error ? { last_error: stats.last_error } : {}),
              },
            }
          : {}),
      };
    },
  }),
  tool({
    name: 'follow_feed',
    title: 'Follow a feed',
    description:
      'Follow an RSS or Atom feed by its address. Following one already followed returns it unchanged.',
    input: z.object({
      url: z.string().describe('The http or https address of the feed.'),
      section_id: id('section')
        .optional()
        .describe('File the new feed under this section.'),
    }),
    readOnly: false,
    run: async ({ url: raw, section_id }, { uid, db, refresh }) => {
      const { url } = checked(parseFeedInput({ url: raw }));
      const repo = new Repository(db);
      if (
        section_id !== undefined &&
        !(await repo.getSection(uid, section_id))
      ) {
        throw new ToolFailure('There is no such section.');
      }
      const existing = await repo.getFeedByUrl(uid, url);
      if (existing) return { feed: feedResource(existing), created: false };
      const feed = await repo.addFeed(uid, url);
      if (!feed) throw new ToolFailure('The feed could not be added.');
      refresh({ id: feed.source_id, url: feed.url });
      const filed =
        section_id !== undefined
          ? await repo.updateFeed(uid, feed.id, { section_id })
          : feed;
      return { feed: feedResource(filed ?? feed), created: true };
    },
  }),
  tool({
    name: 'unfollow_feed',
    title: 'Unfollow a feed',
    description: 'Stop following a feed. Its stories leave the paper.',
    input: z.object({ feed_id: id('feed') }),
    readOnly: false,
    run: async ({ feed_id }, { uid, db }) => {
      if (!(await new Repository(db).removeFeed(uid, feed_id))) {
        throw new ToolFailure('There is no such feed.');
      }
      return { removed: true };
    },
  }),
  tool({
    name: 'read_paper',
    title: "Read today's paper",
    description:
      "Read the person's paper: the stories of one edition, grouped by section and feed, in the order the paper prints them. Disliked and already-read stories are left out.",
    input: z.object({
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe('The edition, as YYYY-MM-DD. Leave out for the latest.'),
    }),
    readOnly: true,
    run: async ({ date }, { uid, db }) => {
      const repo = new Repository(db);
      const [feeds, sections, editions, training, reads] = await Promise.all([
        repo.listFeeds(uid),
        repo.listSections(uid),
        repo.listEditions(uid),
        repo.listClassifiers(uid),
        repo.readState(uid),
      ]);
      const edition =
        date && editions.includes(date)
          ? date
          : (editions[0] ?? todayEdition());
      const names = new Map(
        sections.map((s) => [s.id, sectionPath(sections, s.id)]),
      );
      const desks = await Promise.all(
        feeds
          .filter((f) => !f.muted)
          .map(async (feed) => ({
            feed_id: String(feed.id),
            feed: feed.title ?? feed.url,
            section:
              feed.section_id !== null
                ? (names.get(feed.section_id) ?? null)
                : null,
            stories: rank(
              await repo.sourceArticles(feed.source_id, edition),
              training,
            )
              .filter((a) => !reads.ids.has(a.id) && !reads.urls.has(a.url))
              .map(articleResource),
          })),
      );
      return {
        edition,
        editions: editions.slice(0, 14),
        desks: desks.filter((d) => d.stories.length),
      };
    },
  }),
  tool({
    name: 'search_articles',
    title: 'Search articles',
    description:
      'List or search every edition of the feeds the person follows, newest first by default. With a query, every word must appear in the title, summary, text, author or tags; author:name and tag:name (quoted for several words) match only that field. Narrow by feeds, section, site, dates and read state; disliked stories are left out unless include_hidden is set.',
    input: z.object({
      query: z
        .string()
        .max(MAX_QUERY_LENGTH)
        .default('')
        .describe('The words to look for. Leave blank to list stories.'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_SEARCH)
        .default(20)
        .describe(`How many to return, 1 to ${MAX_SEARCH}.`),
      before: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          'Continue from this article id (the next_before of the last call).',
        ),
      feed_id: id('feed')
        .optional()
        .describe('Only articles from this followed feed.'),
      feed_ids: z
        .array(z.number().int().positive())
        .min(1)
        .max(100)
        .optional()
        .describe('Only articles from any of these followed feeds.'),
      section_id: id('section')
        .optional()
        .describe(
          'Only articles from feeds in this section or its subsections.',
        ),
      domain: z
        .string()
        .max(253)
        .regex(/^[a-z0-9.-]+$/i)
        .optional()
        .describe('Only articles from this website, e.g. example.com.'),
      date_from: isoDate
        .optional()
        .describe(
          'Only articles from editions on or after this day (YYYY-MM-DD).',
        ),
      date_to: isoDate
        .optional()
        .describe(
          'Only articles from editions on or before this day (YYYY-MM-DD).',
        ),
      read_filter: z
        .enum(['all', 'unread', 'read'])
        .default('all')
        .describe(
          'Only stories the person has not opened, or only ones they have.',
        ),
      include_hidden: z
        .boolean()
        .default(false)
        .describe('Include stories the person trained the paper to dislike.'),
      order: z
        .enum(['newest', 'oldest'])
        .default('newest')
        .describe('Newest or oldest first.'),
    }),
    readOnly: true,
    run: async (args, { uid, db }) => {
      const repo = new Repository(db);
      const feeds = await feedScope(repo, uid, args);
      if (feeds?.length === 0) return { articles: [] };
      const [read, training] = await Promise.all([
        args.read_filter === 'all' ? undefined : repo.readState(uid),
        args.include_hidden ? [] : repo.listClassifiers(uid),
      ]);
      const keep = (a: ArticleSummary): boolean =>
        (!read ||
          (read.ids.has(a.id) || read.urls.has(a.url)) ===
            (args.read_filter === 'read')) &&
        verdict(a, training) >= 0;
      const { items, next } = await collect(
        (before, limit) =>
          repo.searchArticles(uid, {
            q: args.query,
            limit,
            oldest: args.order === 'oldest',
            ...(before !== undefined ? { before } : {}),
            ...(feeds ? { feeds } : {}),
            ...(args.domain ? { domain: args.domain } : {}),
            ...(args.date_from ? { from: args.date_from } : {}),
            ...(args.date_to ? { to: args.date_to } : {}),
          }),
        keep,
        args.limit,
        args.before,
      );
      return {
        articles: items.map(articleResource),
        ...(next !== undefined ? { next_before: next } : {}),
      };
    },
  }),
  tool({
    name: 'get_article',
    title: 'Get an article',
    description: 'Get one article with the readable text of its page.',
    input: z.object({ article_id: id('article') }),
    readOnly: true,
    run: async ({ article_id }, { uid, db }) => {
      const article = await new Repository(db).getArticle(uid, article_id);
      if (!article) throw new ToolFailure('There is no such article.');
      return articleDetailResource(article);
    },
  }),
  tool({
    name: 'save_article',
    title: 'Save an article',
    description:
      'Keep an article on the saved list with optional tags, a note and highlighted passages. Saving it again replaces the tags; notes and highlights are replaced only when sent.',
    input: z.object({
      article_id: id('article'),
      tags: z
        .array(z.string())
        .optional()
        .describe("The person's own labels for it."),
      notes: z
        .string()
        .max(MAX_NOTE)
        .nullable()
        .optional()
        .describe('A note on the story; null clears it.'),
      highlights: z
        .array(z.string().trim().min(1).max(MAX_NOTE))
        .max(MAX_HIGHLIGHTS)
        .optional()
        .describe('Passages of the story to mark.'),
    }),
    readOnly: false,
    run: async ({ article_id, tags, notes, highlights }, { uid, db }) => {
      const repo = new Repository(db);
      const before = await repo.getSave(uid, article_id);
      const input = checked(
        parseSaveInput(tags ? { tags } : { tags: before?.tags ?? [] }),
      );
      const saved = await repo.saveArticle(uid, article_id, input.tags);
      if (!saved) throw new ToolFailure('There is no such article.');
      const story =
        notes !== undefined || highlights !== undefined
          ? await repo.annotateSave(uid, article_id, {
              ...(notes !== undefined ? { notes: notes?.trim() || null } : {}),
              ...(highlights !== undefined ? { highlights } : {}),
            })
          : saved.story;
      return { save: saveResource(story!), created: saved.created };
    },
  }),
  tool({
    name: 'unsave_article',
    title: 'Unsave an article',
    description: 'Take an article off the saved list.',
    input: z.object({ article_id: id('article') }),
    readOnly: false,
    run: async ({ article_id }, { uid, db }) => {
      if (!(await new Repository(db).unsaveArticle(uid, article_id))) {
        throw new ToolFailure('That article is not saved.');
      }
      return { removed: true };
    },
  }),
  tool({
    name: 'list_classifiers',
    title: 'List training',
    description:
      'List the likes and dislikes the person trained the paper with, or only those that apply to one feed (its own feed classifier and any naming its source).',
    input: z.object({
      feed_id: id('feed')
        .optional()
        .describe('Only the training that applies to this feed.'),
    }),
    readOnly: true,
    run: async ({ feed_id }, { uid, db }) => {
      const repo = new Repository(db);
      const all = await repo.listClassifiers(uid);
      if (feed_id === undefined) {
        return { classifiers: all.map(classifierResource) };
      }
      const feed = await repo.getFeed(uid, feed_id);
      if (!feed) throw new ToolFailure('There is no such feed.');
      const title = (feed.title ?? '').toLowerCase();
      return {
        classifiers: all
          .filter(
            (c) =>
              (c.kind === 'feed' && c.value === String(feed.source_id)) ||
              (c.kind === 'source' && c.value.toLowerCase() === title),
          )
          .map(classifierResource),
      };
    },
  }),
  tool({
    name: 'train_classifier',
    title: 'Train on a feed',
    description:
      'Train many classifiers at once for one feed: titles, authors, tags and text phrases to like, dislike or super-dislike (a super-dislike hides a story even when something else likes it), and the whole feed itself.',
    input: z.object({
      feed_id: id('feed'),
      ...Object.fromEntries(
        TRAINABLE.flatMap((kind) =>
          (['like', 'dislike', 'super_dislike'] as const).map((score) => [
            `${score}_${kind}`,
            z
              .array(z.string())
              .max(20)
              .optional()
              .describe(
                `${kind === 'text' ? 'Phrases in the text' : `${kind[0]!.toUpperCase()}${kind.slice(1)}s`} to ${score.replace('_', '-')}.`,
              ),
          ]),
        ),
      ),
      like_feed: z
        .boolean()
        .optional()
        .describe('Like every story of the feed.'),
      dislike_feed: z
        .boolean()
        .optional()
        .describe('Dislike every story of the feed.'),
    }),
    readOnly: false,
    run: async (args, { uid, db }) => {
      const input = args as Record<string, unknown> & { feed_id: number };
      const repo = new Repository(db);
      const feed = await repo.getFeed(uid, input.feed_id);
      if (!feed) throw new ToolFailure('There is no such feed.');
      if (input['like_feed'] && input['dislike_feed']) {
        throw new ToolFailure('Like or dislike the feed, not both.');
      }
      const wanted = [
        ...TRAINABLE.flatMap((kind) =>
          (['like', 'dislike', 'super_dislike'] as const).flatMap((score) =>
            ((input[`${score}_${kind}`] as string[] | undefined) ?? []).map(
              (value) => ({ kind, value, score }),
            ),
          ),
        ),
        ...(input['like_feed'] || input['dislike_feed']
          ? [
              {
                kind: 'feed',
                value: String(feed.id),
                score: input['like_feed'] ? 'like' : 'dislike',
              },
            ]
          : []),
      ];
      if (!wanted.length) throw new ToolFailure('Send something to train.');
      const inputs = wanted.map((w) => checked(parseClassifierInput(w)).input);
      const trained = [];
      for (const one of inputs) {
        trained.push((await repo.addClassifier(uid, one)).classifier);
      }
      return { classifiers: trained.map(classifierResource) };
    },
  }),
  tool({
    name: 'add_classifier',
    title: 'Train the paper',
    description:
      'Like or dislike stories by title words, author, tag, text, address, feed or site. Liked stories lead the paper; disliked ones are left out, and a super dislike beats any like. Training the same thing again changes its verdict.',
    input: z.object({
      kind: z
        .enum(['title', 'author', 'tag', 'text', 'url', 'feed', 'source'])
        .describe('What to match on.'),
      value: z
        .string()
        .describe(
          'The title words, author, tag, text, part of the address, feed id or site.',
        ),
      score: z
        .enum(['like', 'dislike', 'super_dislike'])
        .describe('Whether to like, dislike or super dislike.'),
    }),
    readOnly: false,
    run: async (args, { uid, db }) => {
      const { input } = checked(parseClassifierInput(args));
      const repo = new Repository(db);
      if (
        input.kind === 'feed' &&
        !(await repo.getFeed(uid, Number(input.value)))
      ) {
        throw new ToolFailure('value: no such feed.');
      }
      const { classifier, created } = await repo.addClassifier(uid, input);
      return { classifier: classifierResource(classifier), created };
    },
  }),
  tool({
    name: 'remove_classifier',
    title: 'Remove training',
    description: 'Remove one like or dislike, by its id from list_classifiers.',
    input: z.object({ classifier_id: id('classifier') }),
    readOnly: false,
    run: async ({ classifier_id }, { uid, db }) => {
      if (!(await new Repository(db).removeClassifier(uid, classifier_id))) {
        throw new ToolFailure('There is no such classifier.');
      }
      return { removed: true };
    },
  }),

  tool({
    name: 'get_account',
    title: 'Get the account',
    description:
      'Who the person is, and how many feeds, sections, saved stories and classifiers they have.',
    input: z.object({}),
    readOnly: true,
    run: async (_args, { uid, db }) => {
      const repo = new Repository(db);
      const [user, feeds, sections, saves, training] = await Promise.all([
        repo.getUser(uid),
        repo.listFeeds(uid),
        repo.listSections(uid),
        repo.listSaves(uid),
        repo.listClassifiers(uid),
      ]);
      if (!user) throw new ToolFailure('There is no such account.');
      return {
        email: user.email,
        ...(user.name ? { name: user.name } : {}),
        feeds: feeds.length,
        sections: sections.length,
        saved: saves.length,
        classifiers: training.length,
      };
    },
  }),
  tool({
    name: 'organize_feed',
    title: 'Organize a feed',
    description:
      'Rename a feed, mute or unmute it (a muted feed stays followed but leaves the paper), mute it until a time, move it within its section, or file it under a section.',
    input: z.object({
      feed_id: id('feed'),
      title: z
        .string()
        .nullable()
        .optional()
        .describe("A new name for the feed; null goes back to the feed's own."),
      muted: z
        .boolean()
        .optional()
        .describe('Whether to keep it out of the paper.'),
      muted_until: z
        .string()
        .nullable()
        .optional()
        .describe(
          'With muted, when the mute runs out (an RFC 3339 time); null mutes for good.',
        ),
      position: z
        .number()
        .int()
        .optional()
        .describe('Where it goes among the feeds of its section, from 0.'),
      section_id: id('section')
        .nullable()
        .optional()
        .describe('The section to file it under; null takes it out of one.'),
    }),
    readOnly: false,
    run: async ({ feed_id, section_id, ...rest }, { uid, db }) => {
      const { changes } = checked(
        parseFeedChanges({
          ...dropUndefined(rest),
          ...(section_id === undefined
            ? {}
            : { section_id: section_id === null ? null : String(section_id) }),
        }),
      );
      const repo = new Repository(db);
      if (
        typeof changes.section_id === 'number' &&
        !(await repo.getSection(uid, changes.section_id))
      ) {
        throw new ToolFailure('There is no such section.');
      }
      if (!(await repo.getFeed(uid, feed_id))) {
        throw new ToolFailure('There is no such feed.');
      }
      const feed = await repo.updateFeed(uid, feed_id, changes);
      return { feed: feedResource(feed!) };
    },
  }),
  tool({
    name: 'add_section',
    title: 'Add a section',
    description:
      'Add a heading to group feeds under on the front page, nested under another section when given one.',
    input: z.object({
      name: z.string().describe('The heading.'),
      position: z
        .number()
        .int()
        .optional()
        .describe('Where it goes among its sibling sections, from 0.'),
      parent_id: id('parent section')
        .optional()
        .describe('Nest it under this section.'),
    }),
    readOnly: false,
    run: async ({ parent_id, ...rest }, { uid, db }) => {
      const { changes } = checked(
        parseSectionInput(
          {
            ...dropUndefined(rest),
            ...(parent_id !== undefined
              ? { parent_id: String(parent_id) }
              : {}),
          },
          true,
        ),
      );
      const repo = new Repository(db);
      if (
        typeof changes.parent_id === 'number' &&
        !(await repo.canNestUnder(uid, undefined, changes.parent_id))
      ) {
        throw new ToolFailure('There is no such parent section.');
      }
      const section = await repo.addSection(
        uid,
        changes.name!,
        changes.position,
        changes.parent_id ?? null,
      );
      return { section: sectionResource(section) };
    },
  }),
  tool({
    name: 'update_section',
    title: 'Rename or move a section',
    description:
      'Rename a section, change where it goes, or nest it under another section (null for the top level).',
    input: z.object({
      section_id: id('section'),
      name: z.string().optional().describe('The new heading.'),
      position: z
        .number()
        .int()
        .optional()
        .describe('Where it goes among its sibling sections, from 0.'),
      parent_id: id('parent section')
        .nullable()
        .optional()
        .describe(
          'Nest it under this section; null moves it to the top level.',
        ),
    }),
    readOnly: false,
    run: async ({ section_id, parent_id, ...rest }, { uid, db }) => {
      const { changes } = checked(
        parseSectionInput(
          {
            ...dropUndefined(rest),
            ...(parent_id === undefined
              ? {}
              : { parent_id: parent_id === null ? null : String(parent_id) }),
          },
          false,
        ),
      );
      const repo = new Repository(db);
      if (!(await repo.getSection(uid, section_id))) {
        throw new ToolFailure('There is no such section.');
      }
      if (
        typeof changes.parent_id === 'number' &&
        !(await repo.canNestUnder(uid, section_id, changes.parent_id))
      ) {
        throw new ToolFailure(
          'The parent must be another of your sections, not one inside this one.',
        );
      }
      const section = await repo.updateSection(uid, section_id, changes);
      if (!section) throw new ToolFailure('There is no such section.');
      return { section: sectionResource(section) };
    },
  }),
  tool({
    name: 'remove_section',
    title: 'Remove a section',
    description:
      'Remove a section. Its feeds stay followed and move to the top of the paper.',
    input: z.object({ section_id: id('section') }),
    readOnly: false,
    run: async ({ section_id }, { uid, db }) => {
      if (!(await new Repository(db).removeSection(uid, section_id))) {
        throw new ToolFailure('There is no such section.');
      }
      return { removed: true };
    },
  }),
  tool({
    name: 'mark_read',
    title: 'Mark stories read',
    description:
      'Mark stories as read: by id, every story of one feed or section, or every story older than some days. Read stories leave later editions.',
    input: z.object({
      article_ids: z
        .array(z.number().int().positive())
        .max(MAX_MARK)
        .optional()
        .describe('The articles to mark.'),
      feed_id: id('feed')
        .optional()
        .describe(`Mark the newest ${MAX_MARK} stories of this feed.`),
      section_id: id('section')
        .optional()
        .describe(
          `Mark the newest ${MAX_MARK} stories of the feeds in this section.`,
        ),
      older_than_days: z
        .number()
        .int()
        .min(0)
        .max(3650)
        .optional()
        .describe(
          'Only stories from editions at least this many days old (alone, from every feed).',
        ),
    }),
    readOnly: false,
    run: async (
      { article_ids, feed_id, section_id, older_than_days },
      { uid, db },
    ) => {
      if (
        !article_ids?.length &&
        feed_id === undefined &&
        section_id === undefined &&
        older_than_days === undefined
      ) {
        throw new ToolFailure(
          'Send article_ids, feed_id, section_id or older_than_days.',
        );
      }
      const repo = new Repository(db);
      const feeds = await feedScope(repo, uid, {
        ...(feed_id !== undefined ? { feed_id } : {}),
        ...(section_id !== undefined ? { section_id } : {}),
      });
      const to =
        older_than_days === undefined
          ? undefined
          : new Date(Date.now() - older_than_days * 86_400_000)
              .toISOString()
              .slice(0, 10);
      const sweep =
        (feeds === undefined && to === undefined) || feeds?.length === 0
          ? []
          : (
              await repo.searchArticles(uid, {
                limit: MAX_MARK,
                ...(feeds ? { feeds } : {}),
                ...(to ? { to } : {}),
              })
            ).map((a) => a.id);
      const ids = [...new Set([...(article_ids ?? []), ...sweep])].slice(
        0,
        MAX_MARK,
      );
      const outcomes = await Promise.all(ids.map((a) => repo.markRead(uid, a)));
      return {
        marked: outcomes.filter((o) => o === true).length,
        already_read: outcomes.filter((o) => o === false).length,
        not_found: outcomes.filter((o) => o === undefined).length,
      };
    },
  }),
  tool({
    name: 'mark_unread',
    title: 'Mark a story unread',
    description: 'Mark a story the person opened as not read again.',
    input: z.object({ article_id: id('article') }),
    readOnly: false,
    run: async ({ article_id }, { uid, db }) => {
      if (!(await new Repository(db).markUnread(uid, article_id))) {
        throw new ToolFailure('That story is not marked read.');
      }
      return { unread: true };
    },
  }),
  tool({
    name: 'list_saved',
    title: 'List saved stories',
    description:
      "List or search the person's saved stories, newest save first, optionally only those with one tag, with every tag in use. A query matches like search_articles, and its tag:name terms match the person's own tags too.",
    input: z.object({
      tag: z.string().optional().describe('Only stories saved with this tag.'),
      query: z
        .string()
        .max(MAX_QUERY_LENGTH)
        .default('')
        .describe('Words, author:name and tag:name terms to look for.'),
    }),
    readOnly: true,
    run: async ({ tag, query }, { uid, db }) => {
      const repo = new Repository(db);
      const [shown, all] = await Promise.all([
        repo.listSaves(uid, tag, undefined, query),
        tag === undefined && !query ? undefined : repo.listSaves(uid),
      ]);
      return {
        saves: shown.slice(0, MAX_SEARCH).map(saveResource),
        tags: [...new Set((all ?? shown).flatMap((s) => s.tags))].sort((a, b) =>
          a.localeCompare(b),
        ),
      };
    },
  }),
  tool({
    name: 'get_briefing',
    title: 'Get the daily briefing',
    description:
      "The day's issue: the editor's note when one was written, and the stories by section and feed with their tiers.",
    input: z.object({
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe('The day, as YYYY-MM-DD. Leave out for the latest edition.'),
    }),
    readOnly: true,
    run: async ({ date }, { uid, db }) => {
      const repo = new Repository(db);
      const day = date ?? (await repo.listEditions(uid))[0] ?? todayEdition();
      if (!isIssueDate(day))
        throw new ToolFailure('That is not a calendar date.');
      return issueResource(await issueFor(repo, uid, day, uid));
    },
  }),
  tool({
    name: 'get_trending',
    title: 'Get trending stories',
    description:
      "NewsBlur's trending lists of the stories from the feeds the person follows: well read, read time, long reads, good reads or most saved (only counts, never who; a story needs two people behind it).",
    input: z.object({
      order: z
        .enum(TRENDING_ORDERS)
        .default('reads')
        .describe(
          'reads (well read), read_time, long_reads, good_reads or saves.',
        ),
      window: z
        .enum(['day', 'week', 'month'])
        .default('week')
        .describe('How far back to count.'),
      unread: z
        .boolean()
        .default(false)
        .describe('Leave out the stories the person has read.'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_SEARCH)
        .default(20)
        .describe(`How many to return, 1 to ${MAX_SEARCH}.`),
    }),
    readOnly: true,
    run: async ({ order, window, unread, limit }, { uid, db }) => {
      const rows = await new Repository(db).trendingArticles(uid, {
        order,
        since: sqliteSince(new Date(), WINDOWS[window]),
        ...(unread ? { unread } : {}),
        limit,
      });
      return {
        articles: rows
          .slice(0, limit)
          .map((row) => trendingArticleResource(row, order)),
      };
    },
  }),
  tool({
    name: 'discover_feeds',
    title: 'Discover feeds',
    description:
      'Find feeds to follow: ones that people who share a feed with this person also follow, and the starter topics, each with its feeds.',
    input: z.object({
      topic: z
        .string()
        .optional()
        .describe('Only this starter topic (its id or name).'),
    }),
    readOnly: true,
    run: async ({ topic }, { uid, db }) => {
      const wanted = topic?.trim().toLowerCase();
      const topics = TOPICS.filter(
        (t) =>
          !wanted ||
          t.id.toLowerCase() === wanted ||
          t.name.toLowerCase() === wanted,
      );
      if (wanted && !topics.length)
        throw new ToolFailure('There is no such topic.');
      return {
        suggestions: (
          await new Repository(db).suggestSources(uid, MAX_SUGGESTIONS)
        ).map(suggestionResource),
        topics: topics.map((t) => ({ id: t.id, name: t.name, feeds: t.feeds })),
      };
    },
  }),
  tool({
    name: 'ask_archive',
    title: 'Ask the archive',
    description:
      "Ask a question answered from the stories in the person's feeds, saves and reads, with the articles it cites. Continue a conversation with its id.",
    input: z.object({
      question: z.string().max(MAX_QUESTION_LENGTH).describe('The question.'),
      conversation_id: id('conversation')
        .optional()
        .describe('Continue this conversation; leave out to start one.'),
    }),
    readOnly: false,
    run: async ({ question, conversation_id }, { uid, db, model }) => {
      const asked = question.trim();
      if (!asked) throw new ToolFailure('question: must not be blank.');
      const repo = new Repository(db);
      const conversation =
        conversation_id === undefined
          ? await repo.addConversation(uid)
          : await repo.getConversation(uid, conversation_id);
      if (!conversation)
        throw new ToolFailure('There is no such conversation.');
      if (!(await budget(repo, uid, 'assistant')).remaining) {
        throw new ToolFailure(
          'You have used all your assistant questions for today. They reset at midnight UTC.',
        );
      }
      let turn: Awaited<ReturnType<typeof answerTurn>>;
      try {
        turn = await answerTurn(repo, uid, conversation.id, asked, model);
      } catch (error) {
        if (error instanceof AnswerUnavailable) {
          throw new ToolFailure('The assistant could not answer just now.');
        }
        throw error;
      }
      return {
        conversation_id: String(conversation.id),
        message: messageResource(turn.reply, turn.titles),
      };
    },
  }),

  tool({
    name: 'share_story',
    title: 'Share a story',
    description:
      'Share a story from the feeds the person follows, with an optional comment. Shares are public: anyone can list them with the sharer’s name. Sharing again replaces the comment.',
    input: z.object({
      article_id: id('article'),
      comments: z
        .string()
        .max(MAX_NOTE)
        .optional()
        .describe('What the person says about it.'),
    }),
    readOnly: false,
    run: async ({ article_id, comments }, { uid, db }) => {
      if (!(await new Repository(db).getArticle(uid, article_id))) {
        throw new ToolFailure('There is no such article.');
      }
      const { story, created } = await new ShareRepository(db).share(
        uid,
        article_id,
        comments?.trim() || null,
      );
      return { share: shareResource(story), created };
    },
  }),
  tool({
    name: 'unshare_story',
    title: 'Unshare a story',
    description: 'Stop sharing a story.',
    input: z.object({ article_id: id('article') }),
    readOnly: false,
    run: async ({ article_id }, { uid, db }) => {
      if (!(await new ShareRepository(db).unshare(uid, article_id))) {
        throw new ToolFailure('That story is not shared.');
      }
      return { removed: true };
    },
  }),
  tool({
    name: 'get_shared_stories',
    title: 'Get shared stories',
    description:
      'Stories people shared, newest first: everyone’s (the global feed), or only those of the people named, optionally only ones the caller has or has not read.',
    input: z.object({
      sharer_ids: z
        .array(z.number().int().positive())
        .min(1)
        .max(100)
        .optional()
        .describe(
          'Only these people’s shares (sharer ids from earlier results).',
        ),
      read_filter: z
        .enum(['all', 'unread', 'read'])
        .default('all')
        .describe(
          'Only stories the caller has not opened, or only ones they have.',
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_SEARCH)
        .default(20)
        .describe(`How many to return, 1 to ${MAX_SEARCH}.`),
      before: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          'Continue from this share id (the next_before of the last call).',
        ),
    }),
    readOnly: true,
    run: async ({ sharer_ids, read_filter, limit, before }, { uid, db }) => {
      const read =
        read_filter === 'all'
          ? undefined
          : await new Repository(db).readState(uid);
      const shares = new ShareRepository(db);
      const { items, next } = await collect(
        (after, batch) =>
          shares.list({
            limit: batch,
            ...(sharer_ids ? { userIds: sharer_ids } : {}),
            ...(after !== undefined ? { before: after } : {}),
          }),
        (s) =>
          !read ||
          (read.ids.has(s.article.id) || read.urls.has(s.article.url)) ===
            (read_filter === 'read'),
        limit,
        before,
      );
      return {
        shares: items.map(shareResource),
        ...(next !== undefined ? { next_before: next } : {}),
      };
    },
  }),
  tool({
    name: 'get_infrequent_stories',
    title: 'Get stories from quiet feeds',
    description:
      'Stories from the feeds that publish least: those with at most stories_per_month stories in the last 30 days, newest first, so they are not drowned out.',
    input: z.object({
      stories_per_month: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .default(30)
        .describe(
          'The most stories a month a feed may publish to count as quiet.',
        ),
      read_filter: z
        .enum(['all', 'unread', 'read'])
        .default('unread')
        .describe(
          'Only stories the person has not opened, or only ones they have.',
        ),
      include_hidden: z
        .boolean()
        .default(false)
        .describe('Include stories the person trained the paper to dislike.'),
      order: z
        .enum(['newest', 'oldest'])
        .default('newest')
        .describe('Newest or oldest first.'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_SEARCH)
        .default(20)
        .describe(`How many to return, 1 to ${MAX_SEARCH}.`),
      before: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          'Continue from this article id (the next_before of the last call).',
        ),
    }),
    readOnly: true,
    run: async (args, { uid, db }) => {
      const repo = new Repository(db);
      const monthly = await repo.storiesPerMonth(uid);
      const quiet = [...monthly]
        .filter(([, n]) => n <= args.stories_per_month)
        .map(([f]) => f);
      if (!quiet.length) return { feed_ids: [], articles: [] };
      const [read, training] = await Promise.all([
        args.read_filter === 'all' ? undefined : repo.readState(uid),
        args.include_hidden ? [] : repo.listClassifiers(uid),
      ]);
      const { items, next } = await collect(
        (before, limit) =>
          repo.searchArticles(uid, {
            feeds: quiet,
            limit,
            oldest: args.order === 'oldest',
            ...(before !== undefined ? { before } : {}),
          }),
        (a) =>
          (!read ||
            (read.ids.has(a.id) || read.urls.has(a.url)) ===
              (args.read_filter === 'read')) &&
          verdict(a, training) >= 0,
        args.limit,
        args.before,
      );
      return {
        feed_ids: quiet.map(String),
        articles: items.map(articleResource),
        ...(next !== undefined ? { next_before: next } : {}),
      };
    },
  }),
  tool({
    name: 'get_archive_stats',
    title: 'Get archive statistics',
    description:
      'How much of the person’s archive there is: stories, editions and their range, saved and read counts, and stories per feed.',
    input: z.object({}),
    readOnly: true,
    run: async (_args, { uid, db }) => {
      const stats = await new Repository(db).archiveStats(uid);
      return {
        ...stats,
        feeds: stats.feeds.map((f) => ({ ...f, feed_id: String(f.feed_id) })),
      };
    },
  }),
  tool({
    name: 'manage_notifications',
    title: 'Manage notifications',
    description:
      'List, set or remove the notifications for new stories in a feed. Channels are web (push), email and webhook; the filter is unread (any story not disliked) or focus (only liked ones).',
    input: z.object({
      action: z
        .enum(['list', 'set', 'remove'])
        .describe(
          'List every feed’s notifications, set one feed’s, or remove them.',
        ),
      feed_id: id('feed').optional().describe('The feed, for set and remove.'),
      channels: z
        .array(z.enum(NOTIFICATION_CHANNELS))
        .min(1)
        .optional()
        .describe('For set: where to send them.'),
      filter: z
        .enum(NOTIFICATION_FILTERS)
        .default('unread')
        .describe('For set: which new stories to send.'),
    }),
    readOnly: false,
    run: async ({ action, feed_id, channels, filter }, { uid, db }) => {
      const notifications = new NotificationRepository(db);
      if (action === 'list') {
        return {
          notifications: (await notifications.feedNotifications(uid)).map(
            (n) => ({
              ...notificationResource(n.feed_id, n),
              feed_title: n.feed_title,
            }),
          ),
        };
      }
      if (feed_id === undefined) throw new ToolFailure('Send feed_id.');
      if (action === 'remove') {
        if (!(await notifications.removeFeedNotification(uid, feed_id))) {
          throw new ToolFailure('That feed has no notifications.');
        }
        return { removed: true };
      }
      const setting = checked(
        parseNotificationInput({ filter, channels: channels ?? [] }),
      ).value;
      const result = await notifications.setFeedNotification(
        uid,
        feed_id,
        setting,
      );
      if (!result) throw new ToolFailure('There is no such feed.');
      return {
        notification: notificationResource(feed_id, setting),
        created: result.created,
      };
    },
  }),
];
