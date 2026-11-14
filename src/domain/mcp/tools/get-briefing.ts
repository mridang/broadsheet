/**
 * @packageDocumentation
 *
 * `get_briefing`. Everything the tool is lives here: what the catalogue says about
 * it, the arguments it accepts, and what it does when called.
 */

import { issueResource } from '@/domain/api/issue-resource';
import { isIssueDate, issueFor } from '@/domain/issues';
import { type ToolContext } from '@/domain/mcp/tool-context';
import { ZodTool } from '@/domain/mcp/tools/zod-tool';
import { Repository } from '@/domain/repository';
import { todayEdition } from '@/domain/scraping/index';
import { READS, type ToolAnnotations } from '@/lib/mcp';
import { ToolFailureError } from '@/lib/mcp/server';
import { z } from 'zod';

/** What `get_briefing` accepts. */
const SCHEMA = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('The day, as YYYY-MM-DD. Leave out for the latest edition.'),
});

export class GetBriefingTool extends ZodTool<'get_briefing', typeof SCHEMA> {
  readonly name = 'get_briefing';

  readonly title = 'Get the daily briefing';

  readonly description =
    "The day's issue: the editor's note when one was written, and the stories by section and feed with their tiers.";

  readonly input = SCHEMA;

  readonly annotations: ToolAnnotations = READS;

  protected override async runParsed(
    { date }: z.infer<typeof SCHEMA>,
    { uid, db }: ToolContext,
  ): Promise<object> {
    const repo = new Repository(db);
    const editions = date === undefined ? await repo.listEditions(uid) : [];
    const day = date ?? editions[0] ?? todayEdition();
    if (!isIssueDate(day))
      throw new ToolFailureError('That is not a calendar date.');
    return issueResource(await issueFor(repo, uid, day, uid));
  }
}
