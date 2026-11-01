/**
 * @packageDocumentation
 *
 * Following many feeds at once, from an OPML file or from topics: the feeds
 * are checked, the new ones followed and filed under sections (nested ones
 * for nested folders).
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

/**
 * An address as it is compared to find a feed already followed: the scheme,
 * a leading `www.`, the fragment and a trailing slash do not tell feeds apart.
 */
export function comparable(address: string | null | undefined): string {
  if (!address) return '';
  try {
    const url = new URL(address.trim());
    const path = url.pathname.replace(/\/+$/, '');
    return `${url.hostname.replace(/^www\./, '')}${url.port}${path}${url.search}`.toLowerCase();
  } catch {
    return '';
  }
}

/** Follow every valid entry the person does not already follow. */
export async function importFeeds(
  repo: Repository,
  uid: number,
  entries: readonly OpmlFeed[],
): Promise<ImportSummary> {
  const all = await repo.listSections(uid);
  /** Section ids by parent and lower-cased name. */
  const sectionIds = new Map(
    all.map((s) => [`${s.parent_id ?? ''}/${s.name.toLowerCase()}`, s.id]),
  );
  const followed = await repo.listFeeds(uid);
  const addresses = new Set(followed.map((f) => comparable(f.url)));
  const sites = new Set(
    followed.flatMap((f) => (f.site_url ? [comparable(f.site_url)] : [])),
  );
  const titles = new Set(
    followed.flatMap((f) => (f.title ? [f.title.trim().toLowerCase()] : [])),
  );
  const rejected: { url: string; reason: string }[] = [];
  const feeds: Feed[] = [];
  let skipped = 0;
  let sectionsAdded = 0;
  const sectionFor = async (
    path: readonly string[],
  ): Promise<number | null> => {
    let parent: number | null = null;
    for (const raw of path) {
      const name = raw.trim().slice(0, MAX_NAME_LENGTH);
      if (!name) continue;
      const key = `${parent ?? ''}/${name.toLowerCase()}`;
      let id = sectionIds.get(key);
      if (id === undefined) {
        id = (await repo.addSection(uid, name, undefined, parent)).id;
        sectionIds.set(key, id);
        sectionsAdded += 1;
      }
      parent = id;
    }
    return parent;
  };
  for (const entry of entries) {
    const checked = parseFeedInput({ url: entry.url });
    if (!checked.ok) {
      rejected.push({
        url: entry.url.slice(0, 200),
        reason: checked.errors[0] ?? 'not valid.',
      });
      continue;
    }
    const address = comparable(checked.url);
    const site = comparable(entry.site_url);
    const name = entry.title?.trim().toLowerCase() ?? '';
    if (
      addresses.has(address) ||
      (site !== '' && sites.has(site)) ||
      (name !== '' && titles.has(name)) ||
      (await repo.getFeedByUrl(uid, checked.url))
    ) {
      skipped += 1;
      continue;
    }
    const title = entry.title?.slice(0, MAX_NAME_LENGTH);
    const feed = await repo.addFeed(uid, checked.url, title);
    if (!feed) {
      rejected.push({ url: checked.url, reason: 'could not be added.' });
      continue;
    }
    addresses.add(address);
    if (name !== '') titles.add(name);
    if (site !== '') sites.add(site);
    const sectionId = await sectionFor(entry.sections ?? []);
    const changes = {
      ...(sectionId !== null ? { section_id: sectionId } : {}),
      // The person's own name for a feed the source already names otherwise.
      ...(title && feed.title !== title ? { title } : {}),
    };
    feeds.push(
      Object.keys(changes).length
        ? ((await repo.updateFeed(uid, feed.id, changes)) ?? feed)
        : feed,
    );
  }
  return {
    added: feeds.length,
    skipped,
    sections_added: sectionsAdded,
    rejected,
    feeds,
  };
}
