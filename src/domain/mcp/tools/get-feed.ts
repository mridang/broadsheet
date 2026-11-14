/**
 * @packageDocumentation
 *
 * `get_feed`. Everything the tool is lives here: what the catalogue says about
 * it, the arguments it accepts, and what it does when called.
 */

import { feedResource } from '@/domain/api/feed-resource';
import { feedClassifierCounts } from '@/domain/classifier-counts';
import { type ToolContext } from '@/domain/mcp/tool-context';
import { id } from '@/domain/mcp/tools/support';
import { ZodTool } from '@/domain/mcp/tools/zod-tool';
import { Repository } from '@/domain/repository';
import { READS, type ToolAnnotations } from '@/lib/mcp';
import { ToolFailureError } from '@/lib/mcp/server';
import { z } from 'zod';

/** What `get_feed` accepts. */
const SCHEMA = z.object({ feed_id: id('feed') });

export class GetFeedTool extends ZodTool<'get_feed', typeof SCHEMA> {
  readonly name = 'get_feed';

  readonly title = 'Get a feed';

  readonly description =
    'Get one followed feed with its details (site, description, icon, every element of its header) and how its fetching is doing.';

  readonly input = SCHEMA;

  readonly annotations: ToolAnnotations = READS;

  protected override async runParsed(
    { feed_id }: z.infer<typeof SCHEMA>,
    { uid, db }: ToolContext,
  ): Promise<object> {
    const repo = new Repository(db);
    const feed = await repo.getFeed(uid, feed_id);
    if (!feed) throw new ToolFailureError('There is no such feed.');
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
  }
}
