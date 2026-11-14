/**
 * @packageDocumentation
 *
 * `list_saved`. Everything the tool is lives here: what the catalogue says about
 * it, the arguments it accepts, and what it does when called.
 */

import { MAX_QUERY_LENGTH } from '@/domain/api/article-resource';
import { saveResource } from '@/domain/api/save-resource';
import { type ToolContext } from '@/domain/mcp/tool-context';
import { JsonTool } from '@/domain/mcp/tools/json-tool';
import { MAX_SEARCH } from '@/domain/mcp/tools/support';
import { Repository } from '@/domain/repository';
import { READS, type ToolAnnotations } from '@/lib/mcp';
import { z } from 'zod';

/** What `list_saved` accepts. */
const SCHEMA = z.object({
  tag: z.string().optional().describe('Only stories saved with this tag.'),
  query: z
    .string()
    .max(MAX_QUERY_LENGTH)
    .default('')
    .describe('Words, author:name and tag:name terms to look for.'),
});

export class ListSavedTool extends JsonTool<'list_saved', typeof SCHEMA> {
  readonly name = 'list_saved';

  readonly title = 'List saved stories';

  readonly description =
    "List or search the person's saved stories, newest save first, optionally only those with one tag, with every tag in use. A query matches like search_articles, and its tag:name terms match the person's own tags too.";

  readonly input = SCHEMA;

  readonly annotations: ToolAnnotations = READS;

  protected override async runParsed(
    { tag, query }: z.infer<typeof SCHEMA>,
    { user, services }: ToolContext,
  ): Promise<object> {
    const uid = user.id;
    const db = services.openDatabase();
    const repo = new Repository(db);
    const [shown, all] = await Promise.all([
      repo.listSaves(uid, tag, undefined, query),
      tag === undefined && !query ? undefined : repo.listSaves(uid),
    ]);
    return {
      saves: shown.slice(0, MAX_SEARCH).map((s) => saveResource(s)),
      tags: [...new Set((all ?? shown).flatMap((s) => s.tags))].toSorted(
        (a, b) => a.localeCompare(b),
      ),
    };
  }
}
