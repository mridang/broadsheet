/**
 * @packageDocumentation
 *
 * `get_shared_stories`. Everything the tool is lives here: what the catalogue says about
 * it, the arguments it accepts, and what it does when called.
 */

import { type ToolContext } from '@/domain/mcp/tool-context';
import { JsonTool } from '@/domain/mcp/tools/json-tool';
import { collect, MAX_SEARCH, shareResource } from '@/domain/mcp/tools/support';
import { Repository } from '@/domain/repository';
import { ShareRepository } from '@/domain/shares';
import { READS, type ToolAnnotations } from '@/lib/mcp';
import { z } from 'zod';

/** What `get_shared_stories` accepts. */
const SCHEMA = z.object({
  sharer_ids: z
    .array(z.number().int().positive())
    .min(1)
    .max(100)
    .optional()
    .describe('Only these people’s shares (sharer ids from earlier results).'),
  read_filter: z
    .enum(['all', 'unread', 'read'])
    .default('all')
    .describe(
      'Only stories the caller has not opened, or only ones they have.',
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_SEARCH)
    .default(20)
    .describe(`How many to return, 1 to ${MAX_SEARCH}.`),
  before: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      'Continue from this share id (the next_before of the last call).',
    ),
});

export class GetSharedStoriesTool extends JsonTool<
  'get_shared_stories',
  typeof SCHEMA
> {
  readonly name = 'get_shared_stories';

  readonly title = 'Get shared stories';

  readonly description =
    'Stories people shared, newest first: everyone’s (the global feed), or only those of the people named, optionally only ones the caller has or has not read.';

  readonly input = SCHEMA;

  readonly annotations: ToolAnnotations = READS;

  protected override async runParsed(
    { sharer_ids, read_filter, limit, before }: z.infer<typeof SCHEMA>,
    { user, services }: ToolContext,
  ): Promise<object> {
    const uid = user.id;
    const db = services.openDatabase();
    const read =
      read_filter === 'all'
        ? undefined
        : await new Repository(db).readState(uid);
    const shares = new ShareRepository(db);
    const { items, next } = await collect(
      (after, batch) =>
        shares.list({
          limit: batch,
          ...(sharer_ids ? { userIds: sharer_ids } : {}),
          ...(after === undefined ? {} : { before: after }),
        }),
      (s) =>
        !read ||
        (read.ids.has(s.article.id) || read.urls.has(s.article.url)) ===
          (read_filter === 'read'),
      limit,
      before,
    );
    return {
      shares: items.map((s) => shareResource(s)),
      ...(next === undefined ? {} : { next_before: next }),
    };
  }
}
