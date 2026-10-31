/**
 * @packageDocumentation
 *
 * Following many feeds at once, from an OPML file or from topics: the feeds
 * are checked, the new ones followed and filed under sections.
 */

import { parseFeedInput, MAX_NAME_LENGTH } from '@/domain/api/feed-resource';
import type { OpmlFeed } from '@/domain/api/opml';
import type { Feed, Repository } from '@/domain/repository';

/** Most feeds one import may carry. */
export const MAX_IMPORT_FEEDS = 500;

/** What an import did. */
export interface ImportSummary {
  /** Feeds newly followed. */
  readonly added: number;
  /** Feeds the person already followed. */
  readonly skipped: number;
  /** Sections created for folders or topics. */
  readonly sections_added: number;
  /** Entries that were not valid feeds, with why. */
  readonly rejected: readonly {
    readonly url: string;
    readonly reason: string;
  }[];
  /** The feeds newly followed, so their first edition can be fetched. */
  readonly feeds: readonly Feed[];
}

/** Follow every valid entry the person does not already follow. */
export async function importFeeds(
  repo: Repository,
  uid: number,
  entries: readonly OpmlFeed[],
): Promise<ImportSummary> {
  const sections = new Map(
    (await repo.listSections(uid)).map((s) => [s.name.toLowerCase(), s.id]),
  );
  const rejected: { url: string; reason: string }[] = [];
  const feeds: Feed[] = [];
  let skipped = 0;
  let sectionsAdded = 0;
  for (const entry of entries) {
    const checked = parseFeedInput({ url: entry.url });
    if (!checked.ok) {
      rejected.push({
        url: entry.url.slice(0, 200),
        reason: checked.errors[0] ?? 'not valid.',
      });
      continue;
    }
    if (await repo.getFeedByUrl(uid, checked.url)) {
      skipped += 1;
      continue;
    }
    const title = entry.title?.slice(0, MAX_NAME_LENGTH);
    const feed = await repo.addFeed(uid, checked.url, title);
    if (!feed) {
      rejected.push({ url: checked.url, reason: 'could not be added.' });
      continue;
    }
    const name = entry.section?.trim().slice(0, MAX_NAME_LENGTH);
    let filed = feed;
    if (name) {
      let sectionId = sections.get(name.toLowerCase());
      if (sectionId === undefined) {
        sectionId = (await repo.addSection(uid, name)).id;
        sections.set(name.toLowerCase(), sectionId);
        sectionsAdded += 1;
      }
      filed =
        (await repo.updateFeed(uid, feed.id, { section_id: sectionId })) ??
        feed;
    }
    feeds.push(filed);
  }
  return {
    added: feeds.length,
    skipped,
    sections_added: sectionsAdded,
    rejected,
    feeds,
  };
}
