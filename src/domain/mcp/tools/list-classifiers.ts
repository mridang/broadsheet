/**
 * @packageDocumentation
 *
 * `list_classifiers`. Everything the tool is lives here: what the catalogue says about
 * it, the arguments it accepts, and what it does when called.
 */

import { classifierResource } from '@/domain/api/classifier-resource';
import { ToolFailureError } from '@/domain/mcp/tool-failure';
import { type ToolContext } from '@/domain/mcp/tool-context';
import { JsonTool } from '@/domain/mcp/tools/json-tool';
import { id } from '@/domain/mcp/tools/support';
import { Repository } from '@/domain/repository';
import { READS, type ToolAnnotations } from '@/lib/mcp';
import { z } from 'zod';

/** What `list_classifiers` accepts. */
const SCHEMA = z.object({
  feed_id: id('feed')
    .optional()
    .describe('Only the training that applies to this feed.'),
});

export class ListClassifiersTool extends JsonTool<
  'list_classifiers',
  typeof SCHEMA
> {
  readonly name = 'list_classifiers';

  readonly title = 'List training';

  readonly description =
    'List the likes and dislikes the person trained the paper with, or only those that apply to one feed (its own feed classifier and any naming its source).';

  readonly input = SCHEMA;

  readonly annotations: ToolAnnotations = READS;

  protected override async runParsed(
    { feed_id }: z.infer<typeof SCHEMA>,
    { user, services }: ToolContext,
  ): Promise<object> {
    const uid = user.id;
    const db = services.openDatabase();
    const repo = new Repository(db);
    const all = await repo.listClassifiers(uid);
    if (feed_id === undefined) {
      return { classifiers: all.map((c) => classifierResource(c)) };
    }
    const feed = await repo.getFeed(uid, feed_id);
    if (!feed) throw new ToolFailureError('There is no such feed.');
    const title = (feed.title ?? '').toLowerCase();
    return {
      classifiers: all
        .filter(
          (c) =>
            (c.kind === 'feed' && c.value === String(feed.source_id)) ||
            (c.kind === 'source' && c.value.toLowerCase() === title),
        )
        .map((c) => classifierResource(c)),
    };
  }
}
