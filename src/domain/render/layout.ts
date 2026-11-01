/**
 * @packageDocumentation
 *
 * Laying out a paper: which stories each desk prints, in what order and at
 * which tier. Near-duplicates (articles sharing a cluster) print once, as the
 * best of them, which names the other sources that covered it. The result is
 * plain data, so a day's paper can be stored as JSON and read back as printed.
 */
import type { Article, Feed } from '@/domain/repository';
import {
  assignTiers,
  hostOf,
  rank,
  verdict,
  weight,
  type Tier,
  type Training,
} from '@/domain/render/tiers';

/** One story as the paper prints it. */
export interface LaidStory {
  readonly id: number;
  readonly tier: Tier;
  /** The other sources that covered the same story. */
  readonly also: readonly string[];
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

/**
 * Keep one article per cluster across the whole paper: the one the reader
 * likes most, then the weightiest. Returns the ids dropped, the other sources
 * each kept article stands for, and how many sources covered each cluster.
 */
export function collapseClusters(
  articles: readonly Article[],
  training: readonly Training[] = [],
): {
  readonly dropped: ReadonlySet<number>;
  readonly also: ReadonlyMap<number, readonly string[]>;
  readonly coverage: ReadonlyMap<number, number>;
} {
  const members = new Map<number, Article[]>();
  for (const a of articles) {
    if (a.cluster_id === null) continue;
    members.set(a.cluster_id, [...(members.get(a.cluster_id) ?? []), a]);
  }
  const dropped = new Set<number>();
  const also = new Map<number, string[]>();
  const coverage = new Map<number, number>();
  for (const [cluster, group] of members) {
    if (group.length < 2) continue;
    const [kept, ...rest] = group.toSorted(
      (x, y) =>
        verdict(y, training) - verdict(x, training) || weight(y) - weight(x),
    );
    if (!kept) continue;
    rest.forEach((a) => dropped.add(a.id));
    const names = [...new Set(rest.map(byline))].filter(
      (n) => n !== byline(kept),
    );
    also.set(kept.id, names);
    coverage.set(cluster, new Set(group.map((a) => a.source_id)).size);
  }
  return { dropped, also, coverage };
}

/** The most stories one feed's desk prints; the rest stay in the archive. */
export const DESK_STORIES = 14;

/** Lay out a paper from its sections' desks and the reader's training. */
export function layOut(
  groups: readonly DeskGroup[],
  training: readonly Training[] = [],
): Layout {
  const { dropped, also, coverage } = collapseClusters(
    groups.flatMap((g) => g.desks.flatMap((d) => d.articles)),
    training,
  );
  return {
    groups: groups.map((group) => ({
      name: group.name,
      desks: group.desks.map(({ feed, articles }) => {
        const ranked = rank(
          articles.filter((a) => !dropped.has(a.id)),
          training,
          coverage,
        ).slice(0, DESK_STORIES);
        const tiers = assignTiers(ranked);
        return {
          feed_id: feed.id,
          title: feed.title || hostOf(feed.url),
          url: feed.url,
          stories: ranked.map((a, i) => ({
            id: a.id,
            tier: tiers[i] ?? 'standard',
            also: also.get(a.id) ?? [],
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

const TIERS: readonly string[] = ['lead', 'feature', 'standard', 'brief'];

const isStory = (v: unknown): v is LaidStory => {
  const s = v as LaidStory;
  return (
    typeof s === 'object' &&
    s !== null &&
    Number.isInteger(s.id) &&
    TIERS.includes(s.tier) &&
    Array.isArray(s.also) &&
    s.also.every((n) => typeof n === 'string')
  );
};

const isDesk = (v: unknown): v is LaidDesk => {
  const d = v as LaidDesk;
  return (
    typeof d === 'object' &&
    d !== null &&
    Number.isInteger(d.feed_id) &&
    typeof d.title === 'string' &&
    typeof d.url === 'string' &&
    Array.isArray(d.stories) &&
    d.stories.every(isStory)
  );
};

const isGroup = (v: unknown): v is LaidGroup => {
  const g = v as LaidGroup;
  return (
    typeof g === 'object' &&
    g !== null &&
    (g.name === null || typeof g.name === 'string') &&
    Array.isArray(g.desks) &&
    g.desks.every(isDesk)
  );
};

/** A stored layout read back, or undefined when it is not one. */
export function parseLayout(stored: string): Layout | undefined {
  try {
    const parsed = JSON.parse(stored) as Layout;
    return typeof parsed === 'object' &&
      parsed !== null &&
      Array.isArray(parsed.groups) &&
      parsed.groups.every(isGroup)
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}
