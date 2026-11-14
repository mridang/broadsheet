/**
 * @packageDocumentation
 *
 * `get_article`. Everything the tool is lives here: what the catalogue says about
 * it, the arguments it accepts, and what it does when called.
 */

import { articleDetailResource } from '@/domain/api/article-resource';
import { type ToolContext } from '@/domain/mcp/tool-context';
import { id } from '@/domain/mcp/tools/support';
import { ZodTool } from '@/domain/mcp/tools/zod-tool';
import { Repository } from '@/domain/repository';
import { READS, type ToolAnnotations } from '@/lib/mcp';
import { ToolFailureError } from '@/lib/mcp/server';
import { z } from 'zod';

/** What `get_article` accepts. */
const SCHEMA = z.object({ article_id: id('article') });

export class GetArticleTool extends ZodTool<'get_article', typeof SCHEMA> {
  readonly name = 'get_article';

  readonly title = 'Get an article';

  readonly description = 'Get one article with the readable text of its page.';

  readonly input = SCHEMA;

  readonly annotations: ToolAnnotations = READS;

  protected override async runParsed(
    { article_id }: z.infer<typeof SCHEMA>,
    { uid, db }: ToolContext,
  ): Promise<object> {
    const article = await new Repository(db).getArticle(uid, article_id);
    if (!article) throw new ToolFailureError('There is no such article.');
    return articleDetailResource(article);
  }
}
