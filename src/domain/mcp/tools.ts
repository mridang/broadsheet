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
} from '@/domain/api/article-resource';
import {
  classifierResource,
  parseClassifierInput,
} from '@/domain/api/classifier-resource';
import { feedResource, parseFeedInput } from '@/domain/api/feed-resource';
import { parseSaveInput, saveResource } from '@/domain/api/save-resource';
import { sectionResource } from '@/domain/api/section-resource';
import type { Database } from '@/domain/db/database';
import { rank } from '@/domain/render/tiers';
import { Repository } from '@/domain/repository';
import { refreshSource, todayEdition } from '@/domain/scraping/index';
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

/** Every tool, in the order `tools/list` shows them. */
export const TOOLS: readonly McpTool<ToolContext>[] = [
  tool({
    name: 'list_feeds',
    title: 'List feeds and sections',
    description:
      'List the feeds the person follows and the sections they are filed under.',
    input: z.object({}),
    readOnly: true,
    run: async (_args, { uid, db }) => {
      const repo = new Repository(db);
      const [feeds, sections] = await Promise.all([
        repo.listFeeds(uid),
        repo.listSections(uid),
      ]);
      return {
        feeds: feeds.map(feedResource),
        sections: sections.map(sectionResource),
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
    }),
    readOnly: false,
    run: async (args, { uid, db, refresh }) => {
      const { url } = checked(parseFeedInput(args));
      const repo = new Repository(db);
      const existing = await repo.getFeedByUrl(uid, url);
      if (existing) return { feed: feedResource(existing), created: false };
      const feed = await repo.addFeed(uid, url);
      if (!feed) throw new ToolFailure('The feed could not be added.');
      refresh({ id: feed.source_id, url: feed.url });
      return { feed: feedResource(feed), created: true };
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
      const names = new Map(sections.map((s) => [s.id, s.name]));
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
      'Search every edition of the feeds the person follows, newest first. Every word must appear in the title, summary or text.',
    input: z.object({
      query: z
        .string()
        .max(MAX_QUERY_LENGTH)
        .describe('The words to look for. Leave blank to list the newest.'),
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
          'Continue after this article id (the next_before of the last call).',
        ),
    }),
    readOnly: true,
    run: async ({ query, limit, before }, { uid, db }) => {
      const rows = await new Repository(db).searchArticles(uid, {
        q: query,
        limit,
        ...(before !== undefined ? { before } : {}),
      });
      const items = rows.slice(0, limit);
      return {
        articles: items.map(articleResource),
        ...(rows.length > limit && items.length
          ? { next_before: items[items.length - 1]!.id }
          : {}),
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
      'Keep an article on the saved list with optional tags. Saving it again replaces its tags.',
    input: z.object({
      article_id: id('article'),
      tags: z
        .array(z.string())
        .optional()
        .describe("The person's own labels for it."),
    }),
    readOnly: false,
    run: async ({ article_id, tags }, { uid, db }) => {
      const input = checked(parseSaveInput(tags ? { tags } : {}));
      const saved = await new Repository(db).saveArticle(
        uid,
        article_id,
        input.tags,
      );
      if (!saved) throw new ToolFailure('There is no such article.');
      return { save: saveResource(saved.story), created: saved.created };
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
      'List the likes and dislikes the person trained the paper with.',
    input: z.object({}),
    readOnly: true,
    run: async (_args, { uid, db }) => ({
      classifiers: (await new Repository(db).listClassifiers(uid)).map(
        classifierResource,
      ),
    }),
  }),
  tool({
    name: 'add_classifier',
    title: 'Train the paper',
    description:
      'Like or dislike stories by author, source, title words or tag. Liked stories lead the paper; disliked ones are left out. Training the same thing again changes its verdict.',
    input: z.object({
      kind: z
        .enum(['author', 'source', 'title', 'tag'])
        .describe('What to match on.'),
      value: z.string().describe('The author, source, title words or tag.'),
      score: z
        .enum(['like', 'dislike'])
        .describe('Whether to like or dislike.'),
    }),
    readOnly: false,
    run: async (args, { uid, db }) => {
      const { input } = checked(parseClassifierInput(args));
      const { classifier, created } = await new Repository(db).addClassifier(
        uid,
        input,
      );
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
];
