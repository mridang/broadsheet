/**
 * @packageDocumentation
 *
 * `unsave_article`. Everything the tool is lives here: what the catalogue says about
 * it, the arguments it accepts, and what it does when called.
 */

import { type ToolContext } from '@/domain/mcp/tool-context';
import { JsonTool } from '@/domain/mcp/tools/json-tool';
import { id } from '@/domain/mcp/tools/support';
import { Repository } from '@/domain/repository';
import { type ToolAnnotations, ToolFailureError, writes } from '@/lib/mcp';
import { z } from 'zod';

/** What `unsave_article` accepts. */
const SCHEMA = z.object({ article_id: id('article') });

export class UnsaveArticleTool extends JsonTool<
  'unsave_article',
  typeof SCHEMA
> {
  readonly name = 'unsave_article';

  readonly title = 'Unsave an article';

  readonly description = 'Take an article off the saved list.';

  readonly input = SCHEMA;

  readonly annotations: ToolAnnotations = writes({ destructive: true });

  protected override async runParsed(
    { article_id }: z.infer<typeof SCHEMA>,
    { uid, db }: ToolContext,
  ): Promise<object> {
    if (!(await new Repository(db).unsaveArticle(uid, article_id))) {
      throw new ToolFailureError('That article is not saved.');
    }
    return { removed: true };
  }
}
