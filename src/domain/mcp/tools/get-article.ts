/**
 * @packageDocumentation
 *
 * `get_article`. Everything the tool is lives here: what the catalogue says about
 * it, the arguments it accepts, and what it does when called.
 */

import { z } from 'zod';
import { articleDetailResource } from '@/domain/api/article-resource';
import { ToolFailureError } from '@/domain/mcp/tool-failure';
import { JsonTool } from '@/domain/mcp/tools/json-tool';
import { id } from '@/domain/mcp/tools/support';
import { Repository } from '@/domain/repository';
import { READS } from '@/lib/mcp';
import type { ToolAnnotations } from '@/lib/mcp';
import type { ToolContext } from '@/domain/mcp/tool-context';

/** What `get_article` accepts. */
const SCHEMA = z.object({ article_id: id('article') });

export class GetArticleTool extends JsonTool<'get_article', typeof SCHEMA> {
  readonly name = 'get_article';

  readonly title = 'Get an article';

  readonly description = 'Get one article with the readable text of its page.';

  readonly input = SCHEMA;

  readonly annotations: ToolAnnotations = READS;

  protected override async runParsed(
    { article_id }: z.infer<typeof SCHEMA>,
    { user, services }: ToolContext,
  ): Promise<object> {
    const uid = user.id;
    const db = services.openDatabase();
    const article = await new Repository(db).getArticle(uid, article_id);
    if (!article) {
      throw new ToolFailureError('There is no such article.');
    }
    return articleDetailResource(article);
  }
}
