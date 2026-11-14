/**
 * @packageDocumentation
 *
 * `mark_read`. Everything the tool is lives here: what the catalogue says about
 * it, the arguments it accepts, and what it does when called.
 */

import { type ToolContext } from '@/domain/mcp/tool-context';
import { feedScope, id, MAX_MARK } from '@/domain/mcp/tools/support';
import { ZodTool } from '@/domain/mcp/tools/zod-tool';
import { Repository } from '@/domain/repository';
import { type ToolAnnotations, writes } from '@/lib/mcp';
import { ToolFailureError } from '@/lib/mcp/server';
import { z } from 'zod';

/** What `mark_read` accepts. */
const SCHEMA = z.object({
  article_ids: z
    .array(z.number().int().positive())
    .max(MAX_MARK)
    .optional()
    .describe('The articles to mark.'),
  feed_id: id('feed')
    .optional()
    .describe(`Mark the newest ${MAX_MARK} stories of this feed.`),
  section_id: id('section')
    .optional()
    .describe(
      `Mark the newest ${MAX_MARK} stories of the feeds in this section.`,
    ),
  older_than_days: z
    .number()
    .int()
    .min(0)
    .max(3650)
    .optional()
    .describe(
      'Only stories from editions at least this many days old (alone, from every feed).',
    ),
});

export class MarkReadTool extends ZodTool<'mark_read', typeof SCHEMA> {
  readonly name = 'mark_read';

  readonly title = 'Mark stories read';

  readonly description =
    'Mark stories as read: by id, every story of one feed or section, or every story older than some days. Read stories leave later editions.';

  readonly input = SCHEMA;

  readonly annotations: ToolAnnotations = writes();

  protected override async runParsed(
    {
      article_ids,
      feed_id,
      section_id,
      older_than_days,
    }: z.infer<typeof SCHEMA>,
    { uid, db }: ToolContext,
  ): Promise<object> {
    if (
      !article_ids?.length &&
      feed_id === undefined &&
      section_id === undefined &&
      older_than_days === undefined
    ) {
      throw new ToolFailureError(
        'Send article_ids, feed_id, section_id or older_than_days.',
      );
    }
    const repo = new Repository(db);
    const feeds = await feedScope(repo, uid, {
      ...(feed_id === undefined ? {} : { feed_id }),
      ...(section_id === undefined ? {} : { section_id }),
    });
    const to =
      older_than_days === undefined
        ? undefined
        : new Date(Date.now() - older_than_days * 86_400_000)
            .toISOString()
            .slice(0, 10);
    let sweep: number[] = [];
    if ((feeds !== undefined || to !== undefined) && feeds?.length !== 0) {
      const found = await repo.searchArticles(uid, {
        limit: MAX_MARK,
        ...(feeds ? { feeds } : {}),
        ...(to ? { to } : {}),
      });
      sweep = found.map((a) => a.id);
    }
    const ids = [...new Set(article_ids).union(new Set(sweep))].slice(
      0,
      MAX_MARK,
    );
    const outcomes = await Promise.all(ids.map((a) => repo.markRead(uid, a)));
    return {
      marked: outcomes.filter((o) => o === true).length,
      already_read: outcomes.filter((o) => o === false).length,
      not_found: outcomes.filter((o) => o === undefined).length,
    };
  }
}
