/**
 * @packageDocumentation
 *
 * `unfollow_feed`. Everything the tool is lives here: what the catalogue says about
 * it, the arguments it accepts, and what it does when called.
 */

import { type ToolContext } from '@/domain/mcp/tool-context';
import { ToolFailureError } from '@/domain/mcp/tool-failure';
import { JsonTool } from '@/domain/mcp/tools/json-tool';
import { id } from '@/domain/mcp/tools/support';
import { Repository } from '@/domain/repository';
import { type ToolAnnotations, writes } from '@/lib/mcp';
import { z } from 'zod';

/** What `unfollow_feed` accepts. */
const SCHEMA = z.object({ feed_id: id('feed') });

export class UnfollowFeedTool extends JsonTool<'unfollow_feed', typeof SCHEMA> {
  readonly name = 'unfollow_feed';

  readonly title = 'Unfollow a feed';

  readonly description = 'Stop following a feed. Its stories leave the paper.';

  readonly input = SCHEMA;

  readonly annotations: ToolAnnotations = writes({ destructive: true });

  protected override async runParsed(
    { feed_id }: z.infer<typeof SCHEMA>,
    { user, services }: ToolContext,
  ): Promise<object> {
    const uid = user.id;
    const db = services.openDatabase();
    if (!(await new Repository(db).removeFeed(uid, feed_id))) {
      throw new ToolFailureError('There is no such feed.');
    }
    return { removed: true };
  }
}
