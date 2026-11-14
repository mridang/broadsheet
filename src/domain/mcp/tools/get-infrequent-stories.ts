/**
 * @packageDocumentation
 *
 * `get_infrequent_stories`. Everything the tool is lives here: what the catalogue says about
 * it, the arguments it accepts, and what it does when called.
 */

import { articleResource } from '@/domain/api/article-resource';
import { type ToolContext } from '@/domain/mcp/tool-context';
import { JsonTool } from '@/domain/mcp/tools/json-tool';
import { collect, MAX_SEARCH } from '@/domain/mcp/tools/support';
import { verdict } from '@/domain/render/tiers';
import { Repository } from '@/domain/repository';
import { READS, type ToolAnnotations } from '@/lib/mcp';
import { z } from 'zod';

/** What `get_infrequent_stories` accepts. */
const SCHEMA = z.object({
  stories_per_month: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(30)
    .describe('The most stories a month a feed may publish to count as quiet.'),
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
});

export class GetInfrequentStoriesTool extends JsonTool<
  'get_infrequent_stories',
  typeof SCHEMA
> {
  readonly name = 'get_infrequent_stories';

  readonly title = 'Get stories from quiet feeds';

  readonly description =
    'Stories from the feeds that publish least: those with at most stories_per_month stories in the last 30 days, newest first, so they are not drowned out.';

  readonly input = SCHEMA;

  readonly annotations: ToolAnnotations = READS;

  protected override async runParsed(
    args: z.infer<typeof SCHEMA>,
    { user, services }: ToolContext,
  ): Promise<object> {
    const uid = user.id;
    const db = services.openDatabase();
    const repo = new Repository(db);
    const monthly = await repo.storiesPerMonth(uid);
    const quiet = [...monthly]
      .filter(([, n]) => n <= args.stories_per_month)
      .map(([f]) => f);
    if (quiet.length === 0) return { feed_ids: [], articles: [] };
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
          ...(before === undefined ? {} : { before }),
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
      articles: items.map((item) => articleResource(item)),
      ...(next === undefined ? {} : { next_before: next }),
    };
  }
}
