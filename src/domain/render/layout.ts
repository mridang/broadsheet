/**
 * @packageDocumentation
 *
 * Laying out a paper: which stories each desk prints, in what order and at
 * which tier. Near-duplicates (articles sharing a cluster) print once, as the
 * best of them, which names the other sources that covered it. The result is
 * plain data, so a day's paper can be stored as JSON and read back as printed.
 */
import {
  assignTiers,
  hostOf,
  rank,
  verdict,
  weight,
} from '@/domain/render/tiers';
import { matchTier } from '@/domain/titles';
import type { Classifiable, Tier, Training } from '@/domain/render/tiers';
import type { Article, Feed } from '@/domain/repository';

/** One story as the paper prints it. */
export interface LaidStory {
  readonly id: number;
  readonly tier: Tier;
  /** The other sources that covered the same story. */
  readonly also: readonly string[];
  /** The other copies folded into this one (absent in older stored issues). */
  readonly siblings?: readonly Sibling[];
}

/**
 * Another source's copy of a story the paper prints once. `tier` is 'title'
 * when the headlines match, 'related' when only the embeddings joined them.
 */
export interface Sibling {
  readonly id: number;
  readonly source: string;
  readonly url: string;
  readonly tier: 'title' | 'related';
  /** The copy's headline, date, picture and opening (absent in older issues). */
  readonly title?: string;
  readonly published_at?: string;
  readonly image?: string;
  readonly excerpt?: string;
}

/** How much of a copy's text an expanded preview shows. */
export const SIBLING_EXCERPT = 500;

/**
 * How a reader wants clusters printed: not at all (`clustering` false), or
 * folding only copies with matching titles (`mode` 'title') or every copy.
 */
export interface ClusterOptions {
  readonly clustering?: boolean;
  readonly mode?: 'title' | 'related';
}

/** One feed's desk: its heading and its stories in print order. */
export interface LaidDesk {
  readonly feed_id: number;
  readonly title: string;
  readonly url: string;
  readonly stories: readonly LaidStory[];
}

/** A section heading (none for the unfiled desks) and its desks. */
export interface LaidGroup {
  readonly name: string | null;
  readonly desks: readonly LaidDesk[];
}

/** A whole paper. */
export interface Layout {
  readonly groups: readonly LaidGroup[];
}

/** A feed and the articles it brought to this edition. */
export interface Desk {
  readonly feed: Feed;
  readonly articles: readonly Article[];
}

/** A section heading and its desks, before layout. */
export interface DeskGroup {
  readonly name: string | null;
  readonly desks: readonly Desk[];
}

/** The name a story's source goes by in print. */
const byline = (a: Article): string => a.source || hostOf(a.url);

/** What folding the clusters of a paper leaves out, and what it says of what it left out. */
export interface ClusterCollapse {
  readonly dropped: ReadonlySet<number>;
  readonly also: ReadonlyMap<number, readonly string[]>;
  readonly siblings: ReadonlyMap<number, readonly Sibling[]>;
  readonly coverage: ReadonlyMap<number, number>;
}

/**
 * Keep one article per cluster across the whole paper: the one the reader
 * likes most, then one its desk has room to print (in `printable`), then the
 * weightiest. A copy folds into it unless the reader asked for title matches
 * only and its headline differs, or it is from the same source and only the
 * embeddings joined them; a copy that does not fold prints on its own.
 * Returns the ids dropped, the copies each kept article stands for (and their
 * sources' names), and how many sources covered each cluster.
 */
export function collapseClusters(
  articles: readonly (Article & Classifiable)[],
  training: readonly Training[] = [],
  printable?: ReadonlySet<number>,
  options: ClusterOptions = {},
  outside: readonly Article[] = [],
): ClusterCollapse {
  if (options.clustering === false) {
    return {
      dropped: new Set<number>(),
      also: new Map<number, string[]>(),
      siblings: new Map<number, Sibling[]>(),
      coverage: new Map<number, number>(),
    };
  }
  const clustered = (list: readonly Article[]): Map<number, Article[]> =>
    new Map(
      Map.groupBy(
        list.flatMap((a) =>
          a.cluster_id === null ? [] : [{ cluster: a.cluster_id, a }],
        ),
        ({ cluster }) => cluster,
      )
        .entries()
        .map(([cluster, items]) => [cluster, items.map(({ a }) => a)]),
    );
  const members = clustered(articles);
  // Copies from other days or desks the paper does not print: named, never
  // printed, never the one kept.
  const printed = new Set(articles.map((a) => a.id));
  const elsewhere = clustered(outside.filter((a) => !printed.has(a.id)));
  const folds = members
    .entries()
    .flatMap(([cluster, group]) => {
      const extra = elsewhere.get(cluster) ?? [];
      const [first, ...others] =
        group.length + extra.length < 2
          ? []
          : group.toSorted(
              (x, y) =>
                verdict(y, training) - verdict(x, training) ||
                Number(printable?.has(y.id) ?? 0) -
                  Number(printable?.has(x.id) ?? 0) ||
                weight(y) - weight(x),
            );
      if (!first) {
        return [];
      }
      const kept = first;
      const rest = [...others, ...extra];
      const folded = rest
        .values()
        .map((a) => ({ a, tier: matchTier(kept.title, a.title) }))
        .filter(
          ({ a, tier }) =>
            tier === 'title' ||
            (options.mode !== 'title' && a.source_id !== kept.source_id),
        )
        .toArray();
      return folded.length > 0 ? [{ cluster, kept, folded }] : [];
    })
    .toArray();
  return {
    dropped: new Set(
      folds.flatMap(({ folded }) =>
        folded.map(({ a }) => a.id).filter((id) => printed.has(id)),
      ),
    ),
    also: new Map(
      folds.map(({ kept, folded }) => [
        kept.id,
        [...new Set(folded.map(({ a }) => byline(a)))].filter(
          (n) => n !== byline(kept),
        ),
      ]),
    ),
    siblings: new Map(
      folds.map(({ kept, folded }) => [
        kept.id,
        folded.map(({ a, tier }) => ({
          id: a.id,
          source: byline(a),
          url: a.url,
          tier,
          ...(a.title ? { title: a.title } : {}),
          ...(a.published_at ? { published_at: a.published_at } : {}),
          ...(a.image ? { image: a.image } : {}),
          ...(a.summary || a.body_text
            ? {
                excerpt: (a.summary || a.body_text || '').slice(
                  0,
                  SIBLING_EXCERPT,
                ),
              }
            : {}),
        })),
      ]),
    ),
    coverage: new Map(
      folds.map(({ cluster, kept, folded }) => [
        cluster,
        new Set([kept, ...folded.map(({ a }) => a)].map((a) => a.source_id))
          .size,
      ]),
    ),
  };
}

/** The most stories one feed's desk prints; the rest stay in the archive. */
export const DESK_STORIES = 14;

/**
 * Lay out a paper from its sections' desks, the reader's training and how
 * they want clusters printed. Every intelligence level is laid out (disliked
 * stories last), so the reader's level can be applied as the paper is printed.
 */
export function layOut(
  groups: readonly DeskGroup[],
  training: readonly Training[] = [],
  options: ClusterOptions = {},
  outside: readonly Article[] = [],
): Layout {
  // Each story carries the feed it prints under, so feed classifiers match.
  const filed = groups.map((g) => ({
    ...g,
    desks: g.desks.map((d) => ({
      ...d,
      articles: d.articles.map((a) => ({
        ...a,
        feed_id: d.feed.id,
        section_id: d.feed.section_id,
      })),
    })),
  }));
  const all = filed.flatMap((g) => g.desks.flatMap((d) => d.articles));
  // Which stories make their desk's cap before any copy is dropped: keeping
  // one of those means a story several desks carried is never cut from all.
  const allCoverage = collapseClusters(
    all,
    training,
    undefined,
    options,
    outside,
  ).coverage;
  const printable = new Set(
    filed.flatMap((g) =>
      g.desks.flatMap((d) =>
        rank(d.articles, training, allCoverage, 'all')
          .slice(0, DESK_STORIES)
          .map((a) => a.id),
      ),
    ),
  );
  const { dropped, also, siblings, coverage } = collapseClusters(
    all,
    training,
    printable,
    options,
    outside,
  );
  return {
    groups: filed.map((group) => ({
      name: group.name,
      desks: group.desks.map(({ feed, articles }) => {
        const ranked = rank(
          articles.filter((a) => !dropped.has(a.id)),
          training,
          coverage,
          'all',
        ).slice(0, DESK_STORIES);
        const tiers = assignTiers(ranked);
        return {
          feed_id: feed.id,
          title: feed.title || hostOf(feed.url),
          url: feed.url,
          stories: ranked.map((a, index) => ({
            id: a.id,
            tier: tiers[index] ?? 'standard',
            also: also.get(a.id) ?? [],
            siblings: siblings.get(a.id) ?? [],
          })),
        };
      }),
    })),
  };
}

/** Every story id a paper prints. */
export function storyIds(layout: Layout): number[] {
  return layout.groups.flatMap((g) =>
    g.desks.flatMap((d) => d.stories.map((s) => s.id)),
  );
}

/** The paper's top stories: each desk's first, in print order, at most `n`. */
export function topStories(layout: Layout, n: number): number[] {
  return layout.groups
    .flatMap((g) => g.desks.flatMap((d) => d.stories.slice(0, 1)))
    .slice(0, n)
    .map((s) => s.id);
}

const TIERS: ReadonlySet<string> = new Set([
  'lead',
  'feature',
  'standard',
  'brief',
]);

/** Whether each of `keys` on `v` is absent or a string. */
const optionalStrings = (
  v: Sibling,
  keys: readonly (keyof Sibling)[],
): boolean =>
  keys.every((k) => {
    const value: unknown = v[k];
    return value === undefined || typeof value === 'string';
  });

const isSibling = (v: unknown): v is Sibling => {
  if (typeof v !== 'object' || v === null) {
    return false;
  }
  const s = v as Sibling;
  const identity =
    Number.isInteger(s.id) &&
    typeof s.source === 'string' &&
    typeof s.url === 'string';
  const tier = s.tier === 'title' || s.tier === 'related';
  return (
    identity &&
    tier &&
    optionalStrings(s, ['title', 'published_at', 'image', 'excerpt'])
  );
};

const isStory = (v: unknown): v is LaidStory => {
  if (typeof v !== 'object' || v === null) {
    return false;
  }
  const s = v as LaidStory;
  const hasStoryFields =
    Number.isInteger(s.id) && TIERS.has(s.tier) && Array.isArray(s.also);
  const siblings =
    s.siblings === undefined ||
    (Array.isArray(s.siblings) && s.siblings.every(isSibling));
  return (
    hasStoryFields && s.also.every((n) => typeof n === 'string') && siblings
  );
};

const isDesk = (v: unknown): v is LaidDesk => {
  if (typeof v !== 'object' || v === null) {
    return false;
  }
  const d = v as LaidDesk;
  const hasDeskFields =
    Number.isInteger(d.feed_id) &&
    typeof d.title === 'string' &&
    typeof d.url === 'string';
  return hasDeskFields && Array.isArray(d.stories) && d.stories.every(isStory);
};

const isGroup = (v: unknown): v is LaidGroup => {
  if (typeof v !== 'object' || v === null) {
    return false;
  }
  const g = v as LaidGroup;
  return (
    (g.name === null || typeof g.name === 'string') &&
    Array.isArray(g.desks) &&
    g.desks.every(isDesk)
  );
};

/** A stored layout read back, or undefined when it is not one. */
export function parseLayout(stored: string): Layout | undefined {
  try {
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== 'object' || parsed === null) {
      return undefined;
    }
    const layout = parsed as Layout;
    return Array.isArray(layout.groups) && layout.groups.every(isGroup)
      ? layout
      : undefined;
  } catch {
    return undefined;
  }
}
