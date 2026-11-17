/**
 * @packageDocumentation
 *
 * Telling stories apart as NewsBlur does: repairing feeds whose ids are
 * useless, folding the near-duplicates a feed lists twice, and how long to
 * wait before a feed is fetched again. Pure functions; no I/O.
 */

import type { ScrapedItem } from './types';

const BIGRAMS_PATTERN = /\s+/gu;
const MAX_AGE_MINUTES_PATTERN = /(?:^|,)\s*max-age\s*=\s*(\d+)/iu;

/** The pairs of adjacent characters in a text, for {@link similarity}. */
function bigrams(text: string): Map<string, number> {
  const s = text.toLowerCase().replaceAll(BIGRAMS_PATTERN, ' ').trim();
  const pairs = Array.from({ length: Math.max(0, s.length - 1) }, (_, index) =>
    s.slice(index, index + 2),
  );
  return new Map(
    Array.from(
      Map.groupBy(pairs, (pair) => pair),
      ([pair, same]): [string, number] => [pair, same.length],
    ),
  );
}

/**
 * How alike two texts are, from 0 to 1 (the Sørensen–Dice coefficient over
 * character pairs, standing in for Python's `SequenceMatcher.ratio`). Two
 * empty texts are alike.
 */
export function similarity(a: string, b: string): number {
  if (a === b) {
    return 1;
  }
  const x = bigrams(a);
  const y = bigrams(b);
  const total = [...x.values(), ...y.values()].reduce((n, c) => n + c, 0);
  if (!total) {
    return a.trim() === b.trim() ? 1 : 0;
  }
  const shared = [...x].reduce(
    (sum, [pair, count]) => sum + Math.min(count, y.get(pair) ?? 0),
    0,
  );
  return (2 * shared) / total;
}

/** A title at least this alike is a candidate for the same story. */
const SAME_TITLE = 0.75;
/** Content more alike than this is the same story. */
const SAME_CONTENT = 0.98;

/**
 * Whether two items of a feed are the same story: the same id, or a title at
 * least {@link SAME_TITLE} alike and content more than {@link SAME_CONTENT}
 * alike (NewsBlur's `_exists_story`).
 */
export function sameStory(a: ScrapedItem, b: ScrapedItem): boolean {
  if (a.guid && a.guid === b.guid) {
    return true;
  }
  return (
    similarity(a.title, b.title) >= SAME_TITLE &&
    similarity(a.summary, b.summary) > SAME_CONTENT
  );
}

/**
 * A feed's items with ids that tell them apart: when every item carries the
 * same id, the link is the id instead, and when the links collide too, the
 * publication time (NewsBlur's guid repair). Then each story once, keeping
 * the first of each set of {@link sameStory} items.
 */
export function distinctStories(items: readonly ScrapedItem[]): ScrapedItem[] {
  const ids = new Set(items.map((it) => it.guid ?? ''));
  const links = new Set(items.map((it) => it.url));
  const repaired =
    items.length > 1 && ids.size === 1
      ? items.map((it) => ({
          ...it,
          guid:
            links.size === items.length ? it.url : it.published_at || it.url,
        }))
      : [...items];
  const keep = (
    rest: readonly ScrapedItem[],
    kept: readonly ScrapedItem[],
  ): ScrapedItem[] => {
    const [item, ...later] = rest;
    if (!item) {
      return [...kept];
    }
    return keep(
      later,
      kept.some((k) => k.url === item.url || sameStory(k, item))
        ? kept
        : [...kept, item],
    );
  };
  return keep(repaired, []);
}

/** How busy a feed is, for {@link fetchIntervalMinutes}. */
export interface FeedActivity {
  /** Stories it published in the last 30 days. */
  readonly storiesLastMonth: number;
  /** People following it. */
  readonly subscribers: number;
  /** Whole months since its last story; 0 when it published this month. */
  readonly monthsSinceLastStory: number;
  /** Whether anyone is notified of its new stories. */
  readonly notified?: boolean;
}

/** Longest a feed somebody is notified about goes unfetched (NewsBlur's cap). */
export const NOTIFIED_INTERVAL_MINUTES = 30;

/**
 * Minutes until a feed is fetched again, from how often it publishes and how
 * many follow it (NewsBlur's `get_next_scheduled_update`): from 6 minutes for
 * a busy, widely followed feed to a day or more for a quiet one, no more than
 * 4 hours while anyone follows it and 2 days otherwise, and no more than
 * {@link NOTIFIED_INTERVAL_MINUTES} while anyone is notified of it. Never less
 * than 1.
 */
export function fetchIntervalMinutes({
  storiesLastMonth,
  subscribers,
  monthsSinceLastStory,
  notified = false,
}: FeedActivity): number {
  const perDay = storiesLastMonth / 30;
  const base = (() => {
    if (perDay >= 1) {
      if (subscribers >= 10) {
        return 6;
      }
      return subscribers > 1 ? 15 : 45;
    }
    if (perDay > 0) {
      return subscribers > 1 ? 60 - perDay * 60 : 360 - perDay * 360;
    }
    if (subscribers > 1) {
      return 360 * Math.max(1, monthsSinceLastStory);
    }
    return (subscribers === 1 ? 720 : 1440) * Math.max(1, monthsSinceLastStory);
  })();
  const capped = Math.min(base, subscribers >= 1 ? 240 : 2880);
  const minutes = notified
    ? Math.min(capped, NOTIFIED_INTERVAL_MINUTES)
    : capped;
  return Math.max(1, Math.round(minutes));
}

/**
 * The interval with NewsBlur's jitter added, so feeds do not all come due at
 * once: up to a quarter more, or up to double for an interval of 5 minutes or
 * less. `random` is a number from 0 to 1.
 */
export function withJitter(minutes: number, random: number): number {
  const spread = minutes <= 5 ? minutes : minutes / 4;
  return Math.round(minutes + random * spread);
}

/**
 * Minutes a `Cache-Control: max-age` asks a client to keep the answer, or
 * undefined when it sets none.
 */
export function maxAgeMinutes(header: string | null): number | undefined {
  const seconds = MAX_AGE_MINUTES_PATTERN.exec(header ?? '')?.[1];
  return seconds === undefined ? undefined : Math.ceil(Number(seconds) / 60);
}
