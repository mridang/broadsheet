/**
 * @packageDocumentation
 *
 * `list_feeds`. Everything the tool is lives here: what the catalogue says about
 * it, the arguments it accepts, and what it does when called.
 */

import { feedResource } from '@/domain/api/feed-resource';
import { sectionResource } from '@/domain/api/section-resource';
import { type ToolContext } from '@/domain/mcp/tool-context';
import { JsonTool } from '@/domain/mcp/tools/json-tool';
import { Repository } from '@/domain/repository';
import { READS, type ToolAnnotations } from '@/lib/mcp';
import { z } from 'zod';

/** What `list_feeds` accepts. */
const SCHEMA = z.object({
  include_counts: z
    .boolean()
    .default(false)
    .describe('Add unread and monthly story counts to each feed and section.'),
});

export class ListFeedsTool extends JsonTool<'list_feeds', typeof SCHEMA> {
  readonly name = 'list_feeds';

  readonly title = 'List feeds and sections';

  readonly description =
    'List the feeds the person follows and the sections (nested folders) they are filed under, each section with its feed ids. With include_counts, each feed also carries its unread stories and stories in the last 30 days.';

  readonly input = SCHEMA;

  readonly annotations: ToolAnnotations = READS;

  protected override async runParsed(
    { include_counts }: z.infer<typeof SCHEMA>,
    { uid, db }: ToolContext,
  ): Promise<object> {
    const repo = new Repository(db);
    const [feeds, sections, unread, monthly] = await Promise.all([
      repo.listFeeds(uid),
      repo.listSections(uid),
      include_counts ? repo.unreadCounts(uid) : undefined,
      include_counts ? repo.storiesPerMonth(uid) : undefined,
    ]);
    // The full header of every feed is long; get_feed has it for one.
    return {
      feeds: feeds.map((feed) => ({
        ...Object.fromEntries(
          Object.entries(feedResource(feed)).filter(
            ([key]) => key !== 'metadata',
          ),
        ),
        ...(unread
          ? {
              unread: unread.get(feed.id) ?? 0,
              stories_per_month: monthly?.get(feed.id) ?? 0,
            }
          : {}),
      })),
      sections: sections.map((section) => {
        const ids = feeds
          .filter((f) => f.section_id === section.id)
          .map((f) => f.id);
        return {
          ...sectionResource(section),
          feed_ids: ids.map(String),
          ...(unread
            ? {
                unread: ids.reduce((n, f) => n + (unread.get(f) ?? 0), 0),
              }
            : {}),
        };
      }),
    };
  }
}
