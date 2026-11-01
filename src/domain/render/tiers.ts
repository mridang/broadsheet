/**
 * @packageDocumentation
 *
 * The generative layout engine. A story's tier emerges from its position
 * in its section's own weight order (recency + image + length), the tier
 * fixes the lane span and excerpt budget, and the excerpt is copyfit to
 * that budget. Different content ⇒ a different page, with no code change.
 * A person's training shapes the order: liked stories go to the top, where
 * the lead and features are, and disliked ones leave the paper. A story many
 * sources covered (its cluster's size) weighs more.
 */
import type { Article } from '@/domain/repository';

export type Tier = 'lead' | 'feature' | 'standard' | 'brief';

/** tier -> [lane span, excerpt char budget]. */
export const TIER: Record<Tier, readonly [number, number]> = {
  lead: [3, 620],
  feature: [2, 340],
  standard: [1, 190],
  brief: [1, 0],
};

/** Target image width (px) per tier — sized for ~2x retina at its lane span. */
export const IMG_WIDTH: Record<Tier, number> = {
  lead: 800,
  feature: 600,
  standard: 480,
  brief: 480,
};

/**
 * Prominence weight: log(points) + an image bonus, penalised for thin text.
 * Sort a section by this (desc) so the highest-scored story becomes the lead.
 */
export function weight(a: Article): number {
  let w = Math.log((a.points ?? 0) + 1);
  if (a.image) w += 0.6;
  if ((a.summary ?? '').length < 300) w *= 0.6;
  return w;
}

/** A trained like (1) or dislike (-1). */
export interface Training {
  readonly kind: string;
  readonly value: string;
  readonly score: number;
}

/**
 * The parts of a story training matches. Authors and tags are matched only
 * once the scrape records them.
 */
export interface Classifiable {
  readonly title: string | null;
  readonly source: string | null;
  readonly author?: string | null;
  readonly tags?: readonly string[];
  /** The summary and text, matched by `text` classifiers. */
  readonly summary?: string | null;
  readonly body_text?: string | null;
  /** The source it came from, matched by `feed` classifiers (by source id). */
  readonly source_id?: number;
}

const same = (a: string, b: string): boolean =>
  a.localeCompare(b, undefined, { sensitivity: 'base' }) === 0;

/** Whether one classifier matches the story (case-insensitively). */
export function matches(story: Classifiable, c: Training): boolean {
  switch (c.kind) {
    case 'author':
      return !!story.author && same(story.author, c.value);
    case 'source':
      return !!story.source && same(story.source, c.value);
    case 'title':
      return (story.title ?? '').toLowerCase().includes(c.value.toLowerCase());
    case 'tag':
      return (story.tags ?? []).some((t) => same(t, c.value));
    case 'text':
      return `${story.summary ?? ''} ${story.body_text ?? ''}`
        .toLowerCase()
        .includes(c.value.toLowerCase());
    case 'feed':
      return (
        story.source_id !== undefined && String(story.source_id) === c.value
      );
    default:
      return false;
  }
}

/**
 * The person's verdict on a story: -1 when a super-dislike (score -2)
 * matches, whatever else does; otherwise 1 when any classifier likes it (a
 * like wins over a dislike), -1 when one dislikes it, 0 when none match.
 */
export function verdict(
  story: Classifiable,
  training: readonly Training[],
): -1 | 0 | 1 {
  const hits = training.filter((c) => matches(story, c));
  if (hits.some((c) => c.score <= -2)) return -1;
  if (hits.some((c) => c.score > 0)) return 1;
  if (hits.some((c) => c.score < 0)) return -1;
  return 0;
}

/**
 * What a story's coverage adds to its weight: nothing when one source carried
 * it, the log of the number of sources when several did.
 */
export function coverageBoost(sources: number): number {
  return Math.log(Math.max(1, sources));
}

/**
 * A section's stories in the order tiers are assigned: disliked ones dropped,
 * liked ones first, each group by weight (highest first). `coverage` gives the
 * number of sources that covered each cluster, keyed by cluster id.
 */
export function rank<T extends Article>(
  arts: readonly T[],
  training: readonly Training[] = [],
  coverage: ReadonlyMap<number, number> = new Map(),
): T[] {
  const covered = (a: T): number =>
    a.cluster_id === null ? 1 : (coverage.get(a.cluster_id) ?? 1);
  return arts
    .map((a) => ({
      a,
      v: verdict(a, training),
      w: weight(a) + coverageBoost(covered(a)),
    }))
    .filter((x) => x.v >= 0)
    .sort((x, y) => y.v - x.v || y.w - x.w)
    .map((x) => x.a);
}

/** Tiers emerge from the section's own order (highest weight first). */
export function assignTiers(arts: Article[]): Tier[] {
  const n = arts.length;
  return arts.map((a, i) => {
    const hasImg = !!a.image;
    const len = (a.summary ?? '').length;
    if (i === 0 && n >= 5) return 'lead';
    if (i <= Math.max(1, Math.floor(n / 6)) && hasImg && len > 200)
      return 'feature';
    if ((!len || len < 120) && i >= n * 0.5) return 'brief';
    return 'standard';
  });
}

/** Copyfit: trim to the budget at a word boundary, then append an ellipsis. */
export function excerpt(s: string | null, n: number): string {
  const t = (s ?? '').trim();
  return t.length > n ? t.slice(0, n).replace(/\s+\S*$/, '') + '…' : t;
}

export function ago(iso: string | null): string {
  if (!iso) return '';
  const h = (Date.now() - new Date(iso).getTime()) / 36e5;
  if (isNaN(h)) return '';
  if (h < 1) return 'just now';
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export const hostOf = (u: string): string => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
};

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Format a YYYY-MM-DD edition date as "Saturday, June 21, 2026" (UTC, no ICU). */
export function formatEdition(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${WEEKDAYS[dt.getUTCDay()]}, ${MONTHS[m - 1]} ${d}, ${y}`;
}
