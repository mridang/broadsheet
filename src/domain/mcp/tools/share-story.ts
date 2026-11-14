/**
 * @packageDocumentation
 *
 * `share_story`. Everything the tool is lives here: what the catalogue says about
 * it, the arguments it accepts, and what it does when called.
 */

import { type ToolContext } from '@/domain/mcp/tool-context';
import { JsonTool } from '@/domain/mcp/tools/json-tool';
import { id, MAX_NOTE, shareResource } from '@/domain/mcp/tools/support';
import { Repository } from '@/domain/repository';
import { ShareRepository } from '@/domain/shares';
import { type ToolAnnotations, ToolFailureError, writes } from '@/lib/mcp';
import { z } from 'zod';

/** What `share_story` accepts. */
const SCHEMA = z.object({
  article_id: id('article'),
  comments: z
    .string()
    .max(MAX_NOTE)
    .optional()
    .describe('What the person says about it.'),
});

export class ShareStoryTool extends JsonTool<'share_story', typeof SCHEMA> {
  readonly name = 'share_story';

  readonly title = 'Share a story';

  readonly description =
    'Share a story from the feeds the person follows, with an optional comment. Shares are public: anyone can list them with the sharer’s name. Sharing again replaces the comment.';

  readonly input = SCHEMA;

  readonly annotations: ToolAnnotations = writes();

  protected override async runParsed(
    { article_id, comments }: z.infer<typeof SCHEMA>,
    { uid, db }: ToolContext,
  ): Promise<object> {
    if (!(await new Repository(db).getArticle(uid, article_id))) {
      throw new ToolFailureError('There is no such article.');
    }
    const { story, created } = await new ShareRepository(db).share(
      uid,
      article_id,
      comments?.trim() || null,
    );
    return { share: shareResource(story), created };
  }
}
