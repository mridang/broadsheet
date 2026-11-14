/**
 * @packageDocumentation
 *
 * `save_article`. Everything the tool is lives here: what the catalogue says about
 * it, the arguments it accepts, and what it does when called.
 */

import { parseSaveInput, saveResource } from '@/domain/api/save-resource';
import { type ToolContext } from '@/domain/mcp/tool-context';
import {
  checked,
  id,
  MAX_HIGHLIGHTS,
  MAX_NOTE,
} from '@/domain/mcp/tools/support';
import { ZodTool } from '@/domain/mcp/tools/zod-tool';
import { Repository } from '@/domain/repository';
import { type ToolAnnotations, writes } from '@/lib/mcp';
import { ToolFailureError } from '@/lib/mcp/server';
import { z } from 'zod';

/** What `save_article` accepts. */
const SCHEMA = z.object({
  article_id: id('article'),
  tags: z
    .array(z.string())
    .optional()
    .describe("The person's own labels for it."),
  notes: z
    .string()
    .max(MAX_NOTE)
    .nullable()
    .optional()
    .describe('A note on the story; null clears it.'),
  highlights: z
    .array(z.string().trim().min(1).max(MAX_NOTE))
    .max(MAX_HIGHLIGHTS)
    .optional()
    .describe('Passages of the story to mark.'),
});

export class SaveArticleTool extends ZodTool<'save_article', typeof SCHEMA> {
  readonly name = 'save_article';

  readonly title = 'Save an article';

  readonly description =
    'Keep an article on the saved list with optional tags, a note and highlighted passages. Saving it again replaces the tags; notes and highlights are replaced only when sent.';

  readonly input = SCHEMA;

  readonly annotations: ToolAnnotations = writes();

  protected override async runParsed(
    { article_id, tags, notes, highlights }: z.infer<typeof SCHEMA>,
    { uid, db }: ToolContext,
  ): Promise<object> {
    const repo = new Repository(db);
    const before = await repo.getSave(uid, article_id);
    const input = checked(
      parseSaveInput(tags ? { tags } : { tags: before?.tags ?? [] }),
    );
    const saved = await repo.saveArticle(uid, article_id, input.tags);
    if (!saved) throw new ToolFailureError('There is no such article.');
    const story =
      notes !== undefined || highlights !== undefined
        ? await repo.annotateSave(uid, article_id, {
            ...(notes === undefined ? {} : { notes: notes?.trim() || null }),
            ...(highlights === undefined ? {} : { highlights }),
          })
        : saved.story;
    return { save: saveResource(story!), created: saved.created };
  }
}
