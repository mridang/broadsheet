/**
 * @packageDocumentation
 *
 * `unshare_story`. Everything the tool is lives here: what the catalogue says about
 * it, the arguments it accepts, and what it does when called.
 */

import { type ToolContext } from '@/domain/mcp/tool-context';
import { ToolFailureError } from '@/domain/mcp/tool-failure';
import { JsonTool } from '@/domain/mcp/tools/json-tool';
import { id } from '@/domain/mcp/tools/support';
import { ShareRepository } from '@/domain/shares';
import { type ToolAnnotations, writes } from '@/lib/mcp';
import { z } from 'zod';

/** What `unshare_story` accepts. */
const SCHEMA = z.object({ article_id: id('article') });

export class UnshareStoryTool extends JsonTool<'unshare_story', typeof SCHEMA> {
  readonly name = 'unshare_story';

  readonly title = 'Unshare a story';

  readonly description = 'Stop sharing a story.';

  readonly input = SCHEMA;

  readonly annotations: ToolAnnotations = writes({ destructive: true });

  protected override async runParsed(
    { article_id }: z.infer<typeof SCHEMA>,
    { user, services }: ToolContext,
  ): Promise<object> {
    const uid = user.id;
    const db = services.openDatabase();
    if (!(await new ShareRepository(db).unshare(uid, article_id))) {
      throw new ToolFailureError('That story is not shared.');
    }
    return { removed: true };
  }
}
