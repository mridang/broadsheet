/**
 * @packageDocumentation
 *
 * `read_paper`. Everything the tool is lives here: what the catalogue says about
 * it, the arguments it accepts, and what it does when called.
 */

import { articleResource } from '@/domain/api/article-resource';
import { type ToolContext } from '@/domain/mcp/tool-context';
import { JsonTool } from '@/domain/mcp/tools/json-tool';
import { rank } from '@/domain/render/tiers';
import { Repository, sectionPath } from '@/domain/repository';
import { todayEdition } from '@/domain/scraping/index';
import { READS, type ToolAnnotations } from '@/lib/mcp';
import { z } from 'zod';

/** What `read_paper` accepts. */
const SCHEMA = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('The edition, as YYYY-MM-DD. Leave out for the latest.'),
});

export class ReadPaperTool extends JsonTool<'read_paper', typeof SCHEMA> {
  readonly name = 'read_paper';

  readonly title = "Read today's paper";

  readonly description =
    "Read the person's paper: the stories of one edition, grouped by section and feed, in the order the paper prints them. Disliked and already-read stories are left out.";

  readonly input = SCHEMA;

  readonly annotations: ToolAnnotations = READS;

  protected override async runParsed(
    { date }: z.infer<typeof SCHEMA>,
    { user, services }: ToolContext,
  ): Promise<object> {
    const uid = user.id;
    const db = services.openDatabase();
    const repo = new Repository(db);
    const [feeds, sections, editions, training, reads] = await Promise.all([
      repo.listFeeds(uid),
      repo.listSections(uid),
      repo.listEditions(uid),
      repo.listClassifiers(uid),
      repo.readState(uid),
    ]);
    const edition =
      date && editions.includes(date) ? date : (editions[0] ?? todayEdition());
    const names = new Map(
      sections.map((s) => [s.id, sectionPath(sections, s.id)]),
    );
    const desks = await Promise.all(
      feeds
        .filter((f) => !f.muted)
        .map(async (feed) => ({
          feed_id: String(feed.id),
          feed: feed.title ?? feed.url,
          section:
            feed.section_id === null
              ? null
              : (names.get(feed.section_id) ?? null),
          stories: rank(
            await repo.sourceArticles(feed.source_id, edition),
            training,
          )
            .filter((a) => !reads.ids.has(a.id) && !reads.urls.has(a.url))
            .map((a) => articleResource(a)),
        })),
    );
    return {
      edition,
      editions: editions.slice(0, 14),
      desks: desks.filter((d) => d.stories.length),
    };
  }
}
