/**
 * @packageDocumentation
 *
 * Dashboard rivers, as NewsBlur has them: story lists a person pins to the
 * left or right column of their front page, in order. A river is named by
 * what it lists: `all` (every feed), `saves`, or `feed:{id}`, `section:{id}`,
 * `search:{id}` or `edition:{id}` for one of the person's own. Kept apart
 * from {@link Repository}; the stories each lists come from there.
 */

import { and, asc, eq } from 'drizzle-orm';

import { type Database } from '@/domain/db/database';
import { rivers } from '@/domain/db/schema';
import { editionIssueFor } from '@/domain/issues';
import { storyIds } from '@/domain/render/layout';
import { Repository, type ArticleSummary } from '@/domain/repository';

/** The columns a river can sit in. */
export const RIVER_SIDES = ['left', 'right'] as const;

/** A column of the front page. */
export type RiverSide = (typeof RIVER_SIDES)[number];

/** The most rivers a person may pin. */
export const MAX_RIVERS = 20;

/** A pinned river. */
export type River = Omit<typeof rivers.$inferSelect, 'side'> & {
  readonly side: RiverSide;
};

/** Where a river sits and what it lists. */
export interface RiverInput {
  readonly river_id: string;
  readonly side: RiverSide;
  readonly position: number;
}

/** What a river id names, once read. */
type RiverSource = 'feed' | 'section' | 'search' | 'edition';

export type RiverTarget =
  | { readonly kind: 'all' | 'saves' }
  | {
      readonly kind: RiverSource;
      readonly id: number;
    };

/** Read a river id, or undefined when it names nothing a river can list. */
export function parseRiverId(riverId: string): RiverTarget | undefined {
  if (riverId === 'all' || riverId === 'saves') return { kind: riverId };
  const match = /^(feed|section|search|edition):([1-9]\d{0,14})$/.exec(riverId);
  return match
    ? {
        kind: match[1] as RiverSource,
        id: Number(match[2]),
      }
    : undefined;
}

/** A stored row as a {@link River}. */
function riverOf(row: typeof rivers.$inferSelect): River {
  return { ...row, side: row.side === 'right' ? 'right' : 'left' };
}

/** The person's rivers, and pinning, moving and removing them. */
export class RiverRepository {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  /** The person's rivers: the left column, then the right, each in order. */
  async list(userId: number): Promise<River[]> {
    const rows = await this.#db
      .select()
      .from(rivers)
      .where(eq(rivers.user_id, userId))
      .orderBy(asc(rivers.side), asc(rivers.position));
    return rows.map((row) => riverOf(row));
  }

  /**
   * Pin a river at a place, or change what the river already there lists.
   * `created` says whether the place was empty.
   */
  async place(
    userId: number,
    input: RiverInput,
  ): Promise<{ readonly river: River; readonly created: boolean }> {
    const at = and(
      eq(rivers.user_id, userId),
      eq(rivers.side, input.side),
      eq(rivers.position, input.position),
    );
    const [moved] = await this.#db
      .update(rivers)
      .set({ river_id: input.river_id })
      .where(at)
      .returning();
    if (moved) return { river: riverOf(moved), created: false };
    const [row] = await this.#db
      .insert(rivers)
      .values({ user_id: userId, ...input })
      .returning();
    return { river: riverOf(row!), created: true };
  }

  /** Replace all of the person's rivers with these, in one go. */
  async replace(userId: number, list: readonly RiverInput[]): Promise<River[]> {
    await this.#db.batch([
      this.#db.delete(rivers).where(eq(rivers.user_id, userId)),
      ...list.map((input) =>
        this.#db.insert(rivers).values({ user_id: userId, ...input }),
      ),
    ]);
    return this.list(userId);
  }

  /**
   * Remove one of the person's rivers and close the gap it leaves in its
   * column. True when they had it.
   */
  async remove(userId: number, id: number): Promise<boolean> {
    const [gone] = await this.#db
      .delete(rivers)
      .where(and(eq(rivers.id, id), eq(rivers.user_id, userId)))
      .returning();
    if (!gone) return false;
    const all = await this.list(userId);
    const rest = all.filter((r) => r.side === gone.side);
    for (const [position, river] of rest.entries()) {
      if (river.position !== position) {
        await this.#db
          .update(rivers)
          .set({ position })
          .where(eq(rivers.id, river.id));
      }
    }
    return true;
  }
}

/**
 * Whether a river target names something of the person's: their feed,
 * section, saved search or custom edition. `all` and `saves` always do.
 */
export async function ownsTarget(
  db: Database,
  userId: number,
  target: RiverTarget,
): Promise<boolean> {
  const repo = new Repository(db);
  switch (target.kind) {
    case 'all':
    case 'saves': {
      return true;
    }
    case 'feed': {
      return !!(await repo.getFeed(userId, target.id));
    }
    case 'section': {
      return !!(await repo.getSection(userId, target.id));
    }
    case 'search': {
      return !!(await repo.getSearch(userId, target.id));
    }
    case 'edition': {
      return !!(await repo.getCustomEdition(userId, target.id));
    }
  }
}

/**
 * The newest stories a river lists for the person, at most `limit`; none
 * when what it names is gone.
 */
export async function riverStories(
  db: Database,
  userId: number,
  riverId: string,
  limit: number,
): Promise<ArticleSummary[]> {
  const target = parseRiverId(riverId);
  if (!target || !(await ownsTarget(db, userId, target))) return [];
  const repo = new Repository(db);
  switch (target.kind) {
    case 'all': {
      const found = await repo.searchArticles(userId, { limit });
      return found.slice(0, limit);
    }
    case 'saves': {
      const saves = await repo.listSaves(userId);
      return saves.slice(0, limit).map((s) => s.article);
    }
    case 'feed': {
      const found = await repo.searchArticles(userId, {
        feed: target.id,
        limit,
      });
      return found.slice(0, limit);
    }
    case 'section': {
      const allFeeds = await repo.listFeeds(userId);
      const feeds = allFeeds.filter((f) => f.section_id === target.id);
      const lists = await Promise.all(
        feeds.map((f) => repo.searchArticles(userId, { feed: f.id, limit })),
      );
      return lists
        .flat()
        .toSorted((a, b) => b.id - a.id)
        .slice(0, limit);
    }
    case 'search': {
      const search = await repo.getSearch(userId, target.id);
      const found = await repo.searchArticles(userId, {
        q: search!.query,
        ...(search!.feed_id === null ? {} : { feed: search!.feed_id }),
        limit,
      });
      return found.slice(0, limit);
    }
    case 'edition': {
      const edition = await repo.getCustomEdition(userId, target.id);
      const [latest] = await repo.listEditions(userId);
      if (!edition || !latest) return [];
      const issue = await editionIssueFor(repo, edition, latest);
      return repo.articlesByIds(storyIds(issue.layout).slice(0, limit));
    }
  }
}

/** Something a river can list, with the name it shows under. */
export interface RiverChoice {
  readonly river_id: string;
  readonly label: string;
}

/** Everything of the person's a river can list, named. */
export async function riverChoices(
  db: Database,
  userId: number,
): Promise<RiverChoice[]> {
  const repo = new Repository(db);
  const [feeds, sections, searches, editions] = await Promise.all([
    repo.listFeeds(userId),
    repo.listSections(userId),
    repo.listSearches(userId),
    repo.listCustomEditions(userId),
  ]);
  return [
    { river_id: 'all', label: 'All stories' },
    { river_id: 'saves', label: 'Saved stories' },
    ...feeds.map((f) => ({
      river_id: `feed:${f.id}`,
      label: f.title || f.url,
    })),
    ...sections.map((s) => ({ river_id: `section:${s.id}`, label: s.name })),
    ...searches.map((s) => ({
      river_id: `search:${s.id}`,
      label: `Search: ${s.query}`,
    })),
    ...editions.map((e) => ({ river_id: `edition:${e.id}`, label: e.name })),
  ];
}

/** How many stories a river shows on the front page. */
const RIVER_STORIES = 5;

/**
 * The person's rivers filled with their newest stories and names, and the
 * choices for pinning another: what the front page shows.
 */
export async function frontPageRivers(
  db: Database,
  userId: number,
): Promise<{
  readonly rivers: {
    readonly river: River;
    readonly label: string;
    readonly stories: ArticleSummary[];
  }[];
  readonly options: RiverChoice[];
}> {
  const [pinned, options] = await Promise.all([
    new RiverRepository(db).list(userId),
    riverChoices(db, userId),
  ]);
  const labels = new Map(options.map((o) => [o.river_id, o.label]));
  const rivers = await Promise.all(
    pinned
      .filter((river) => labels.has(river.river_id))
      .map(async (river) => ({
        river,
        label: labels.get(river.river_id)!,
        stories: await riverStories(db, userId, river.river_id, RIVER_STORIES),
      })),
  );
  return { rivers, options };
}
