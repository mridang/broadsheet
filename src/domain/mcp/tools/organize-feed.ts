/**
 * @packageDocumentation
 *
 * `organize_feed`. Everything the tool is lives here: what the catalogue says about
 * it, the arguments it accepts, and what it does when called.
 */

import { feedResource, parseFeedChanges } from '@/domain/api/feed-resource';
import { type ToolContext } from '@/domain/mcp/tool-context';
import { checked, dropUndefined, id } from '@/domain/mcp/tools/support';
import { ZodTool } from '@/domain/mcp/tools/zod-tool';
import { Repository } from '@/domain/repository';
import { type ToolAnnotations, writes } from '@/lib/mcp';
import { ToolFailureError } from '@/lib/mcp/server';
import { z } from 'zod';

/** What `organize_feed` accepts. */
const SCHEMA = z.object({
  feed_id: id('feed'),
  title: z
    .string()
    .nullable()
    .optional()
    .describe("A new name for the feed; null goes back to the feed's own."),
  muted: z
    .boolean()
    .optional()
    .describe('Whether to keep it out of the paper.'),
  muted_until: z
    .string()
    .nullable()
    .optional()
    .describe(
      'With muted, when the mute runs out (an RFC 3339 time); null mutes for good.',
    ),
  position: z
    .number()
    .int()
    .optional()
    .describe('Where it goes among the feeds of its section, from 0.'),
  section_id: id('section')
    .nullable()
    .optional()
    .describe('The section to file it under; null takes it out of one.'),
});

export class OrganizeFeedTool extends ZodTool<'organize_feed', typeof SCHEMA> {
  readonly name = 'organize_feed';

  readonly title = 'Organize a feed';

  readonly description =
    'Rename a feed, mute or unmute it (a muted feed stays followed but leaves the paper), mute it until a time, move it within its section, or file it under a section.';

  readonly input = SCHEMA;

  readonly annotations: ToolAnnotations = writes();

  protected override async runParsed(
    { feed_id, section_id, ...rest }: z.infer<typeof SCHEMA>,
    { uid, db }: ToolContext,
  ): Promise<object> {
    const { changes } = checked(
      parseFeedChanges({
        ...dropUndefined(rest),
        ...(section_id === undefined
          ? {}
          : { section_id: section_id === null ? null : String(section_id) }),
      }),
    );
    const repo = new Repository(db);
    if (
      typeof changes.section_id === 'number' &&
      !(await repo.getSection(uid, changes.section_id))
    ) {
      throw new ToolFailureError('There is no such section.');
    }
    if (!(await repo.getFeed(uid, feed_id))) {
      throw new ToolFailureError('There is no such feed.');
    }
    const feed = await repo.updateFeed(uid, feed_id, changes);
    return { feed: feedResource(feed!) };
  }
}
