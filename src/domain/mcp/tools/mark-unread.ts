/**
 * @packageDocumentation
 *
 * `mark_unread`. Everything the tool is lives here: what the catalogue says about
 * it, the arguments it accepts, and what it does when called.
 */

import { type ToolContext } from '@/domain/mcp/tool-context';
import { ToolFailureError } from '@/domain/mcp/tool-failure';
import { JsonTool } from '@/domain/mcp/tools/json-tool';
import { id } from '@/domain/mcp/tools/support';
import { Repository } from '@/domain/repository';
import { type ToolAnnotations, writes } from '@/lib/mcp';
import { z } from 'zod';

/** What `mark_unread` accepts. */
const SCHEMA = z.object({ article_id: id('article') });

export class MarkUnreadTool extends JsonTool<'mark_unread', typeof SCHEMA> {
  readonly name = 'mark_unread';

  readonly title = 'Mark a story unread';

  readonly description = 'Mark a story the person opened as not read again.';

  readonly input = SCHEMA;

  readonly annotations: ToolAnnotations = writes();

  protected override async runParsed(
    { article_id }: z.infer<typeof SCHEMA>,
    { user, services }: ToolContext,
  ): Promise<object> {
    const uid = user.id;
    const db = services.openDatabase();
    if (!(await new Repository(db).markUnread(uid, article_id))) {
      throw new ToolFailureError('That story is not marked read.');
    }
    return { unread: true };
  }
}
