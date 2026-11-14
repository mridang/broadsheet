/**
 * @packageDocumentation
 *
 * `search_articles`. Everything the tool is lives here: what the catalogue says about
 * it, the arguments it accepts, and what it does when called.
 */

import {
  articleResource,
  MAX_QUERY_LENGTH,
} from '@/domain/api/article-resource';
import { type ToolContext } from '@/domain/mcp/tool-context';
import {
  collect,
  feedScope,
  id,
  isoDate,
  MAX_SEARCH,
} from '@/domain/mcp/tools/support';
import { ZodTool } from '@/domain/mcp/tools/zod-tool';
import { verdict } from '@/domain/render/tiers';
import { ArticleSummary, Repository } from '@/domain/repository';
import { READS, type ToolAnnotations } from '@/lib/mcp';
import { z } from 'zod';

/** What `search_articles` accepts. */
const SCHEMA = z.object({
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
    .describe('Only articles from feeds in this section or its subsections.'),
  domain: z
    .string()
    .max(253)
    .regex(/^[a-z0-9.-]+$/i)
    .optional()
    .describe('Only articles from this website, e.g. example.com.'),
  date_from: isoDate
    .optional()
    .describe('Only articles from editions on or after this day (YYYY-MM-DD).'),
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
});

export class SearchArticlesTool extends ZodTool<
  'search_articles',
  typeof SCHEMA
> {
  readonly name = 'search_articles';

  readonly title = 'Search articles';

  readonly description =
    'List or search every edition of the feeds the person follows, newest first by default. With a query, every word must appear in the title, summary, text, author or tags; author:name and tag:name (quoted for several words) match only that field. Narrow by feeds, section, site, dates and read state; disliked stories are left out unless include_hidden is set.';

  readonly input = SCHEMA;

  readonly annotations: ToolAnnotations = READS;

  protected override async runParsed(
    args: z.infer<typeof SCHEMA>,
    { uid, db }: ToolContext,
  ): Promise<object> {
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
          ...(before === undefined ? {} : { before }),
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
      articles: items.map((item) => articleResource(item)),
      ...(next === undefined ? {} : { next_before: next }),
    };
  }
}
