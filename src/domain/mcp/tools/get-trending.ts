/**
 * @packageDocumentation
 *
 * `get_trending`. Everything the tool is lives here: what the catalogue says about
 * it, the arguments it accepts, and what it does when called.
 */

import {
  sqliteSince,
  trendingArticleResource,
  WINDOWS,
} from '@/domain/api/article-resource';
import { type ToolContext } from '@/domain/mcp/tool-context';
import { JsonTool } from '@/domain/mcp/tools/json-tool';
import { MAX_SEARCH } from '@/domain/mcp/tools/support';
import { Repository, TRENDING_ORDERS } from '@/domain/repository';
import { READS, type ToolAnnotations } from '@/lib/mcp';
import { z } from 'zod';

/** What `get_trending` accepts. */
const SCHEMA = z.object({
  order: z
    .enum(TRENDING_ORDERS)
    .default('reads')
    .describe('reads (well read), read_time, long_reads, good_reads or saves.'),
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
});

export class GetTrendingTool extends JsonTool<'get_trending', typeof SCHEMA> {
  readonly name = 'get_trending';

  readonly title = 'Get trending stories';

  readonly description =
    "NewsBlur's trending lists of the stories from the feeds the person follows: well read, read time, long reads, good reads or most saved (only counts, never who; a story needs two people behind it).";

  readonly input = SCHEMA;

  readonly annotations: ToolAnnotations = READS;

  protected override async runParsed(
    { order, window, unread, limit }: z.infer<typeof SCHEMA>,
    { user, services }: ToolContext,
  ): Promise<object> {
    const uid = user.id;
    const db = services.openDatabase();
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
  }
}
