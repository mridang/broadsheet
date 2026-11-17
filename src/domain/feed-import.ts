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

const COMPARABLE_PATTERN = /^www\./u;

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
export function comparable(address?: string | null): string {
  if (!address) {
    return '';
  }
  try {
    const url = new URL(address.trim());
    const path = trimTrailingSlashes(url.pathname);
    return `${url.hostname.replace(COMPARABLE_PATTERN, '')}${url.port}${path}${url.search}`.toLowerCase();
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
  const start: Progress = {
    sectionIds,
    addresses,
    sites,
    titles,
    // The feeds this import followed, by comparable address.
    added: new Map<string, Feed>(),
    feeds: [],
    rejected: [],
    skipped: 0,
    sectionsAdded: 0,
  };
  const sectionFor = async (
    progress: Progress,
    path: readonly string[],
  ): Promise<readonly [number | null, Progress]> =>
    path.reduce<Promise<readonly [number | null, Progress]>>(
      async (previous, raw) => {
        const [parent, current] = await previous;
        const name = raw.trim().slice(0, MAX_NAME_LENGTH);
        if (!name) {
          return [parent, current];
        }
        const key = `${parent ?? ''}/${name.toLowerCase()}`;
        const known = current.sectionIds.get(key);
        if (known !== undefined) {
          return [known, current];
        }
        const section = await repo.addSection(uid, name, undefined, parent);
        return [
          section.id,
          {
            ...current,
            sectionIds: new Map([...current.sectionIds, [key, section.id]]),
            sectionsAdded: current.sectionsAdded + 1,
          },
        ];
      },
      Promise.resolve([null, progress] as const),
    );
  const importEntry = async (
    progress: Progress,
    entry: OpmlFeed,
  ): Promise<Progress> => {
    const checked = parseFeedInput({ url: entry.url });
    if (!checked.ok) {
      return {
        ...progress,
        rejected: [
          ...progress.rejected,
          {
            url: entry.url.slice(0, 200),
            reason: checked.errors[0] ?? 'not valid.',
          },
        ],
      };
    }
    const address = comparable(checked.url);
    const site = comparable(entry.site_url);
    // The same feed again in this file, under another folder, is filed in
    // that section too, as a NewsBlur feed can sit in several folders.
    const again = progress.added.get(address);
    if (again) {
      const [sectionId, after] = await sectionFor(
        progress,
        entry.sections ?? [],
      );
      if (sectionId !== null && !again.section_ids.includes(sectionId)) {
        const filed =
          (await repo.updateFeed(uid, again.id, {
            section_ids: [...again.section_ids, sectionId],
          })) ?? again;
        return {
          ...after,
          added: new Map([...after.added, [address, filed]]),
          feeds: after.feeds.map((f) => (f === again ? filed : f)),
        };
      }
      return after;
    }
    const name = entry.title?.trim().toLowerCase() ?? '';
    const knownFeed =
      progress.addresses.has(address) ||
      (site !== '' && progress.sites.has(site));
    if (
      knownFeed ||
      (name !== '' && progress.titles.has(name)) ||
      (await repo.getFeedByUrl(uid, checked.url))
    ) {
      return { ...progress, skipped: progress.skipped + 1 };
    }
    const title = entry.title?.slice(0, MAX_NAME_LENGTH);
    const feed = await repo.addFeed(uid, checked.url, title);
    if (!feed) {
      return {
        ...progress,
        rejected: [
          ...progress.rejected,
          { url: checked.url, reason: 'could not be added.' },
        ],
      };
    }
    const withFeed: Progress = {
      ...progress,
      addresses: new Set([...progress.addresses, address]),
      titles:
        name === '' ? progress.titles : new Set([...progress.titles, name]),
      sites: site === '' ? progress.sites : new Set([...progress.sites, site]),
    };
    const [sectionId, after] = await sectionFor(withFeed, entry.sections ?? []);
    const changes = {
      ...(sectionId === null ? {} : { section_id: sectionId }),
      // The person's own name for a feed the source already names otherwise.
      ...(title && feed.title !== title ? { title } : {}),
    };
    const filed =
      Object.keys(changes).length > 0
        ? ((await repo.updateFeed(uid, feed.id, changes)) ?? feed)
        : feed;
    return {
      ...after,
      feeds: [...after.feeds, filed],
      added: new Map([...after.added, [address, filed]]),
    };
  };
  const done = await entries.reduce<Promise<Progress>>(
    async (previous, entry) => importEntry(await previous, entry),
    Promise.resolve(start),
  );
  return {
    added: done.feeds.length,
    skipped: done.skipped,
    sections_added: done.sectionsAdded,
    rejected: done.rejected,
    feeds: done.feeds,
  };
}

/** Where an import has got to, one entry at a time. */
interface Progress {
  readonly sectionIds: ReadonlyMap<string, number>;
  readonly addresses: ReadonlySet<string>;
  readonly sites: ReadonlySet<string>;
  readonly titles: ReadonlySet<string>;
  readonly added: ReadonlyMap<string, Feed>;
  readonly feeds: readonly Feed[];
  readonly rejected: readonly {
    readonly url: string;
    readonly reason: string;
  }[];
  readonly skipped: number;
  readonly sectionsAdded: number;
}

/** Drops the trailing slashes; same as `.replace(/\/+$/, '')`, in linear time. */
function trimTrailingSlashes(text: string): string {
  const parts = text.split('/');
  return parts
    .slice(0, parts.findLastIndex((part) => part !== '') + 1)
    .join('/');
}
