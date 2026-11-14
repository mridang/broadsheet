/**
 * @packageDocumentation
 *
 * `get_archive_stats`. Everything the tool is lives here: what the catalogue says about
 * it, the arguments it accepts, and what it does when called.
 */

import { type ToolContext } from '@/domain/mcp/tool-context';
import { JsonTool } from '@/domain/mcp/tools/json-tool';
import { Repository } from '@/domain/repository';
import { READS, type ToolAnnotations } from '@/lib/mcp';
import { z } from 'zod';

/** What `get_archive_stats` accepts. */
const SCHEMA = z.object({});

export class GetArchiveStatsTool extends JsonTool<
  'get_archive_stats',
  typeof SCHEMA
> {
  readonly name = 'get_archive_stats';

  readonly title = 'Get archive statistics';

  readonly description =
    'How much of the person’s archive there is: stories, editions and their range, saved and read counts, and stories per feed.';

  readonly input = SCHEMA;

  readonly annotations: ToolAnnotations = READS;

  protected override async runParsed(
    _args: z.infer<typeof SCHEMA>,
    { uid, db }: ToolContext,
  ): Promise<object> {
    const stats = await new Repository(db).archiveStats(uid);
    return {
      ...stats,
      feeds: stats.feeds.map((f) => ({ ...f, feed_id: String(f.feed_id) })),
    };
  }
}
