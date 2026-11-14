/**
 * @packageDocumentation
 *
 * `discover_feeds`. Everything the tool is lives here: what the catalogue says about
 * it, the arguments it accepts, and what it does when called.
 */

import { MAX_SUGGESTIONS, suggestionResource } from '@/domain/api/suggestions';
import { type ToolContext } from '@/domain/mcp/tool-context';
import { JsonTool } from '@/domain/mcp/tools/json-tool';
import { Repository } from '@/domain/repository';
import { TOPICS } from '@/domain/topics';
import { READS, type ToolAnnotations, ToolFailureError } from '@/lib/mcp';
import { z } from 'zod';

/** What `discover_feeds` accepts. */
const SCHEMA = z.object({
  topic: z
    .string()
    .optional()
    .describe('Only this starter topic (its id or name).'),
});

export class DiscoverFeedsTool extends JsonTool<
  'discover_feeds',
  typeof SCHEMA
> {
  readonly name = 'discover_feeds';

  readonly title = 'Discover feeds';

  readonly description =
    'Find feeds to follow: ones that people who share a feed with this person also follow, and the starter topics, each with its feeds.';

  readonly input = SCHEMA;

  readonly annotations: ToolAnnotations = READS;

  protected override async runParsed(
    { topic }: z.infer<typeof SCHEMA>,
    { uid, db }: ToolContext,
  ): Promise<object> {
    const wanted = topic?.trim().toLowerCase();
    const topics = TOPICS.filter(
      (t) =>
        !wanted ||
        t.id.toLowerCase() === wanted ||
        t.name.toLowerCase() === wanted,
    );
    if (wanted && topics.length === 0)
      throw new ToolFailureError('There is no such topic.');
    const suggested = await new Repository(db).suggestSources(
      uid,
      MAX_SUGGESTIONS,
    );
    return {
      suggestions: suggested.map((s) => suggestionResource(s)),
      topics: topics.map((t) => ({ id: t.id, name: t.name, feeds: t.feeds })),
    };
  }
}
