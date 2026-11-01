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
import { rank } from '@/domain/render/tiers';
import { Repository } from '@/domain/repository';
import { refreshSource, todayEdition } from '@/domain/scraping/index';
import { messageResource } from '@/domain/api/conversation-resource';
import { issueResource } from '@/domain/api/issue-resource';
import { MAX_SUGGESTIONS, suggestionResource } from '@/domain/api/suggestions';
import {
  AnswerUnavailable,
  archivePrompt,
  citedIds,
  complete,
  MAX_QUESTION_LENGTH,
  type AnswerModel,
} from '@/domain/assistant';
import { issueFor, isIssueDate } from '@/domain/issues';
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
      'List the feeds the person follows and the sections they are filed under.',
    input: z.object({}),
    readOnly: true,
    run: async (_args, { uid, db }) => {
      const repo = new Repository(db);
      const [feeds, sections] = await Promise.all([
        repo.listFeeds(uid),
        repo.listSections(uid),
      ]);
      // The full header of every feed is long; get_feed has it for one.
      return {
        feeds: feeds.map((feed) => {
          return Object.fromEntries(
            Object.entries(feedResource(feed)).filter(
              ([key]) => key !== 'metadata',
            ),
          );
        }),
        sections: sections.map(sectionResource),
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
      const stats = await repo.feedStatistics(uid, feed_id);
      return {
        feed: feedResource(feed),
        ...(stats
          ? {
              statistics: {
                fail_count: stats.fail_count,
                stories_per_day: stats.stories_per_day,
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
      feed_id: id('feed')
        .optional()
        .describe('Only articles from this followed feed.'),
      read_filter: z
        .enum(['all', 'unread', 'read'])
        .default('all')
        .describe(
          'Only stories the person has not opened, or only ones they have.',
        ),
    }),
    readOnly: true,
    run: async (
      { query, limit, before, feed_id, read_filter },
      { uid, db },
    ) => {
      const repo = new Repository(db);
      const rows = await repo.searchArticles(uid, {
        q: query,
        limit,
        ...(before !== undefined ? { before } : {}),
        ...(feed_id !== undefined ? { feed: feed_id } : {}),
      });
      const items = rows.slice(0, limit);
      // Filtered within the page, so a page may hold fewer than `limit`.
      const read =
        read_filter === 'all' ? undefined : (await repo.readState(uid)).ids;
      const shown = read
        ? items.filter((a) => read.has(a.id) === (read_filter === 'read'))
        : items;
      return {
        articles: shown.map(articleResource),
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
      'Rename a feed, mute or unmute it (a muted feed stays followed but leaves the paper), or file it under a section.',
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
      section_id: id('section')
        .nullable()
        .optional()
        .describe('The section to file it under; null takes it out of one.'),
    }),
    readOnly: false,
    run: async ({ feed_id, section_id, ...rest }, { uid, db }) => {
      const { changes } = checked(
        parseFeedChanges({
          ...rest,
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
    description: 'Add a heading to group feeds under on the front page.',
    input: z.object({
      name: z.string().describe('The heading.'),
      position: z
        .number()
        .int()
        .optional()
        .describe('Where it goes among the sections, from 0.'),
    }),
    readOnly: false,
    run: async (args, { uid, db }) => {
      const { changes } = checked(parseSectionInput(dropUndefined(args), true));
      const section = await new Repository(db).addSection(
        uid,
        changes.name!,
        changes.position,
      );
      return { section: sectionResource(section) };
    },
  }),
  tool({
    name: 'update_section',
    title: 'Rename or move a section',
    description: 'Rename a section or change where it goes.',
    input: z.object({
      section_id: id('section'),
      name: z.string().optional().describe('The new heading.'),
      position: z
        .number()
        .int()
        .optional()
        .describe('Where it goes among the sections, from 0.'),
    }),
    readOnly: false,
    run: async ({ section_id, ...rest }, { uid, db }) => {
      const { changes } = checked(
        parseSectionInput(dropUndefined(rest), false),
      );
      const section = await new Repository(db).updateSection(
        uid,
        section_id,
        changes,
      );
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
      'Mark stories as read, by id or every story of one feed. Read stories leave later editions.',
    input: z.object({
      article_ids: z
        .array(z.number().int().positive())
        .max(MAX_MARK)
        .optional()
        .describe('The articles to mark.'),
      feed_id: id('feed')
        .optional()
        .describe(`Mark the newest ${MAX_MARK} stories of this feed.`),
    }),
    readOnly: false,
    run: async ({ article_ids, feed_id }, { uid, db }) => {
      if (!article_ids?.length && feed_id === undefined) {
        throw new ToolFailure('Send article_ids or feed_id.');
      }
      const repo = new Repository(db);
      if (feed_id !== undefined && !(await repo.getFeed(uid, feed_id))) {
        throw new ToolFailure('There is no such feed.');
      }
      const fromFeed =
        feed_id === undefined
          ? []
          : (
              await repo.searchArticles(uid, { feed: feed_id, limit: MAX_MARK })
            ).map((a) => a.id);
      const ids = [...new Set([...(article_ids ?? []), ...fromFeed])].slice(
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
    name: 'list_saved',
    title: 'List saved stories',
    description:
      "List the person's saved stories, newest save first, optionally only those with one tag, with every tag in use.",
    input: z.object({
      tag: z.string().optional().describe('Only stories saved with this tag.'),
    }),
    readOnly: true,
    run: async ({ tag }, { uid, db }) => {
      const repo = new Repository(db);
      const [shown, all] = await Promise.all([
        repo.listSaves(uid, tag),
        tag === undefined ? undefined : repo.listSaves(uid),
      ]);
      return {
        saves: shown.slice(0, MAX_SEARCH).map(saveResource),
        tags: [...new Set((all ?? shown).flatMap((s) => s.tags))].sort(),
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
      'The stories from the feeds the person follows that readers opened or saved most lately (only counts, never who).',
    input: z.object({
      order: z
        .enum(['reads', 'saves'])
        .default('reads')
        .describe('Rank by reads or by saves.'),
      window: z
        .enum(['day', 'week', 'month'])
        .default('week')
        .describe('How far back to count.'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_SEARCH)
        .default(20)
        .describe(`How many to return, 1 to ${MAX_SEARCH}.`),
    }),
    readOnly: true,
    run: async ({ order, window, limit }, { uid, db }) => {
      const rows = await new Repository(db).trendingArticles(uid, {
        order,
        since: sqliteSince(new Date(), WINDOWS[window]),
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
      const history = await repo.listMessages(conversation.id);
      const passages = await repo.retrievePassages(uid, asked);
      let answer: string;
      try {
        answer = await complete(model, archivePrompt(passages, history, asked));
      } catch (error) {
        if (error instanceof AnswerUnavailable) {
          throw new ToolFailure('The assistant could not answer just now.');
        }
        throw error;
      }
      await repo.addMessage(conversation.id, 'user', asked);
      const reply = await repo.addMessage(
        conversation.id,
        'assistant',
        answer,
        citedIds(answer, passages),
      );
      const titles = new Map(passages.map((p) => [p.id, p.title] as const));
      return {
        conversation_id: String(conversation.id),
        message: messageResource(reply, titles),
      };
    },
  }),
];
