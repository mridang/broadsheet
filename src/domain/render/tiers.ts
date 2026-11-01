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
import { regexProblem } from '@/domain/rules';
import { relativeTime, truncate } from '@/lib/intl';

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

/**
 * A trained like (1), dislike (-1) or super dislike (-2), everywhere or only
 * in one feed or one section, as NewsBlur's feed, folder and global scopes.
 */
export interface Training {
  readonly kind: string;
  readonly value: string;
  readonly score: number;
  readonly scope_feed_id?: number | null;
  readonly scope_section_id?: number | null;
  /** The value is a regular expression (1 or true); title, author, text, url. */
  readonly is_regex?: number | boolean;
  /** The classifier's id, which `prompt` classifiers are matched by. */
  readonly id?: number;
}

/**
 * The parts of a story training matches. `tags` is the feed's categories,
 * as a list or as the JSON array an article stores; `feed_id` is the feed
 * (subscription) the story is printed under, when known, and scoped
 * classifiers only reach stories whose feed or section is known.
 */
export interface Classifiable {
  readonly title: string | null;
  readonly source: string | null;
  readonly author?: string | null;
  readonly tags?: string | readonly string[] | null;
  readonly summary?: string | null;
  readonly body_text?: string | null;
  readonly url?: string;
  readonly feed_id?: number;
  /** The section the story's feed is filed under, when known. */
  readonly section_id?: number | null;
  /** The `prompt` classifiers the AI found the story matches, by id. */
  readonly prompt_ids?: ReadonlySet<number>;
}

/**
 * How much of the paper training lets through, as NewsBlur's intelligence
 * levels: `focus` only liked stories, `unread` all but disliked ones, `all`
 * every story, disliked ones last.
 */
export type Intelligence = 'focus' | 'unread' | 'all';

/** The levels, from the narrowest. */
export const INTELLIGENCE: readonly Intelligence[] = ['focus', 'unread', 'all'];

/** The lowest verdict each level shows. */
const FLOOR: Record<Intelligence, number> = { focus: 1, unread: 0, all: -2 };

/** Whether a story with this verdict shows at this level. */
export function shows(v: number, level: Intelligence = 'unread'): boolean {
  return v >= FLOOR[level];
}

const same = (a: string, b: string): boolean =>
  a.localeCompare(b, undefined, { sensitivity: 'base' }) === 0;

const has = (text: string | null | undefined, phrase: string): boolean =>
  (text ?? '').toLowerCase().includes(phrase.toLowerCase());

const wordy = (c: string | undefined): boolean =>
  !!c && /[\p{L}\p{N}\p{M}_]/u.test(c);

/**
 * Whether a title holds the phrase, as NewsBlur matches titles: ignoring case,
 * and where the phrase starts with a letter or digit, only at the start of a
 * word ("art" matches "Art of war" but not "start").
 */
export function titleHas(title: string | null, phrase: string): boolean {
  const t = (title ?? '').toLowerCase();
  const p = phrase.toLowerCase();
  if (!p) return false;
  for (let at = t.indexOf(p); at >= 0; at = t.indexOf(p, at + 1)) {
    if (!wordy(p[0]) || !wordy(t[at - 1])) return true;
  }
  return false;
}

/** A story's tags, whether stored as JSON or already a list. */
export function tagsOf(tags: Classifiable['tags']): readonly string[] {
  if (!tags) return [];
  if (typeof tags !== 'string') return tags;
  try {
    const parsed: unknown = JSON.parse(tags);
    return Array.isArray(parsed)
      ? parsed.filter((t): t is string => typeof t === 'string')
      : [];
  } catch {
    return [];
  }
}

/** Whether one classifier matches the story (case-insensitively). */
export function matches(story: Classifiable, c: Training): boolean {
  if (c.is_regex) return regexMatches(story, c);
  switch (c.kind) {
    case 'prompt':
      return c.id !== undefined && !!story.prompt_ids?.has(c.id);
    case 'author':
      return !!story.author && same(story.author, c.value);
    case 'source':
      return !!story.source && same(story.source, c.value);
    case 'feed':
      return story.feed_id !== undefined && String(story.feed_id) === c.value;
    case 'title':
      return titleHas(story.title, c.value);
    case 'url':
      return has(story.url, c.value);
    case 'text':
      return has(story.summary, c.value) || has(story.body_text, c.value);
    case 'tag':
      return tagsOf(story.tags).some((t) => same(t, c.value));
    default:
      return false;
  }
}

/** Whether a classifier's scope reaches the story's feed. */
function inScope(story: Classifiable, c: Training): boolean {
  if (c.scope_feed_id != null) return story.feed_id === c.scope_feed_id;
  if (c.scope_section_id != null) {
    return story.section_id === c.scope_section_id;
  }
  return true;
}

/**
 * Whether a regular-expression classifier matches, as NewsBlur's: over the
 * title, the author, the summary and text, or the address, ignoring case. A
 * pattern `regexProblem` refuses never matches, and the text is capped, as a
 * Worker cannot stop a slow match.
 */
function regexMatches(story: Classifiable, c: Training): boolean {
  const text =
    c.kind === 'title'
      ? story.title
      : c.kind === 'author'
        ? story.author
        : c.kind === 'url'
          ? story.url
          : c.kind === 'text'
            ? [story.summary, story.body_text].filter(Boolean).join(' ')
            : undefined;
  if (!text || regexProblem(c.value)) return false;
  return new RegExp(c.value, 'i').test(text.slice(0, MAX_REGEX_TEXT));
}

/** The most text a regular-expression classifier runs over. */
const MAX_REGEX_TEXT = 20_000;

/** Kinds about the whole feed or site, which yield to the story's own. */
const BROAD: ReadonlySet<string> = new Set(['feed', 'source', 'prompt']);

/** A verdict: super dislike, dislike, neutral or like. */
export type Verdict = -2 | -1 | 0 | 1;

/**
 * The score of the matching classifiers: a super dislike beats everything,
 * then a like beats a dislike.
 */
function score(hits: readonly Training[]): Verdict {
  if (hits.some((c) => c.score <= -2)) return -2;
  if (hits.some((c) => c.score > 0)) return 1;
  if (hits.some((c) => c.score < 0)) return -1;
  return 0;
}

/**
 * The person's verdict on a story, as NewsBlur's `compute_story_score`: an AI
 * prompt the story matches decides first; then the classifiers on the story
 * itself (title, author, tag, text, URL, plain or regular expressions), a
 * super dislike beating any like and a like beating a dislike; only when none
 * of those match do the feed and site ones count.
 */
export function verdict(
  story: Classifiable,
  training: readonly Training[],
): Verdict {
  const hits = training.filter((c) => inScope(story, c) && matches(story, c));
  // An AI prompt that matches decides, as NewsBlur's prompt score does.
  const prompted = score(hits.filter((c) => c.kind === 'prompt'));
  if (prompted) return prompted;
  return (
    score(hits.filter((c) => !BROAD.has(c.kind))) ||
    score(hits.filter((c) => BROAD.has(c.kind)))
  );
}

/**
 * What a story's coverage adds to its weight: nothing when one source carried
 * it, the log of the number of sources when several did.
 */
export function coverageBoost(sources: number): number {
  return Math.log(Math.max(1, sources));
}

/**
 * A section's stories in the order tiers are assigned: those `level` does not
 * show dropped, liked ones first and disliked ones last, each group by weight
 * (highest first). `coverage` gives the number of sources that covered each
 * cluster, keyed by cluster id.
 */
export function rank<T extends Article & Classifiable>(
  arts: readonly T[],
  training: readonly Training[] = [],
  coverage: ReadonlyMap<number, number> = new Map(),
  level: Intelligence = 'unread',
): T[] {
  const covered = (a: T): number =>
    a.cluster_id === null ? 1 : (coverage.get(a.cluster_id) ?? 1);
  return arts
    .map((a) => ({
      a,
      v: verdict(a, training),
      w: weight(a) + coverageBoost(covered(a)),
    }))
    .filter((x) => shows(x.v, level))
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
  return truncate(t, n);
}

export function ago(iso: string | null): string {
  if (!iso || Number.isNaN(Date.parse(iso))) return '';
  return relativeTime(iso);
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
