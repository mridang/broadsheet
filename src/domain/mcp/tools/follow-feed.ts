/**
 * @packageDocumentation
 *
 * `follow_feed`. Everything the tool is lives here: what the catalogue says about
 * it, the arguments it accepts, and what it does when called.
 */

import { feedResource, parseFeedInput } from '@/domain/api/feed-resource';
import { type ToolContext } from '@/domain/mcp/tool-context';
import { checked, id } from '@/domain/mcp/tools/support';
import { ZodTool } from '@/domain/mcp/tools/zod-tool';
import { Repository } from '@/domain/repository';
import { type ToolAnnotations, writes } from '@/lib/mcp';
import { ToolFailureError } from '@/lib/mcp/server';
import { z } from 'zod';

/** What `follow_feed` accepts. */
const SCHEMA = z.object({
  url: z.string().describe('The http or https address of the feed.'),
  section_id: id('section')
    .optional()
    .describe('File the new feed under this section.'),
});

export class FollowFeedTool extends ZodTool<'follow_feed', typeof SCHEMA> {
  readonly name = 'follow_feed';

  readonly title = 'Follow a feed';

  readonly description =
    'Follow an RSS or Atom feed by its address. Following one already followed returns it unchanged.';

  readonly input = SCHEMA;

  readonly annotations: ToolAnnotations = writes();

  protected override async runParsed(
    { url: raw, section_id }: z.infer<typeof SCHEMA>,
    { uid, db, refresh }: ToolContext,
  ): Promise<object> {
    const { url } = checked(parseFeedInput({ url: raw }));
    const repo = new Repository(db);
    if (section_id !== undefined && !(await repo.getSection(uid, section_id))) {
      throw new ToolFailureError('There is no such section.');
    }
    const existing = await repo.getFeedByUrl(uid, url);
    if (existing) return { feed: feedResource(existing), created: false };
    const feed = await repo.addFeed(uid, url);
    if (!feed) throw new ToolFailureError('The feed could not be added.');
    refresh({ id: feed.source_id, url: feed.url });
    const filed =
      section_id === undefined
        ? feed
        : await repo.updateFeed(uid, feed.id, { section_id });
    return { feed: feedResource(filed ?? feed), created: true };
  }
}
