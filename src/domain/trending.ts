/**
 * @packageDocumentation
 *
 * How the trending lists are ranked and served, after NewsBlur's
 * `RTrendingStory` and `RTrendingSubscription`: each story's readers are
 * scored per list, the ranked list is spread out so no feed, site, publisher
 * or topic crowds a block and no source holds more than a tenth of it, and
 * new followers count less the older they are. Pure functions; the
 * repository gathers the rows.
 */

/** The fewest distinct people behind anything trending. */
export const MIN_PEOPLE = 2;

/** Reads shorter than this many seconds do not count as time spent. */
export const MIN_READ_SECONDS = 3;

/** The most seconds one read counts for. */
export const MAX_READ_SECONDS = 20 * 60;

/** A deep read, for long and good reads: at least this many seconds. */
export const GOOD_READ_SECONDS = 30;

/** Good reads with no save need this many deep readers instead. */
export const GOOD_READ_FALLBACK_READERS = 4;

/** The fewest words of a long read, and of a good read. */
export const MIN_LONG_WORDS = 600;
export const MIN_GOOD_WORDS = 250;

/** How many stories each list keeps before it is spread out. */
export const LIST_SIZE = {
  reads: 200,
  read_time: 200,
  saves: 200,
  long_reads: 2000,
  good_reads: 2000,
} as const;

/** Stories per diversity block, and the most of one topic in a block. */
export const BLOCK_SIZE = 12;
export const MAX_TOPIC_PER_BLOCK = 3;

/** The most of a list one source may hold. */
export const MAX_SOURCE_SHARE = 0.1;

/** Good reads keep this many places for small feeds, of at most this many followers. */
export const SMALL_FEED_SLOTS = 4;
export const SMALL_FEED_FOLLOWERS = 50;

/** New followers need this weighted score to make a feed trend. */
export const MIN_FOLLOW_SCORE = 4;

/** Words that put a story in a topic, first match wins. */
const TOPIC_KEYWORDS: readonly (readonly [string, RegExp])[] = [
  [
    'technology',
    /\b(ai|android|code|developer|hack|security|software|technology|windows)\b/,
  ],
  [
    'science',
    /\b(astronomy|biology|climate|earth|medicine|physics|science|space|weather)\b/,
  ],
  ['sports & games', /\b(football|game|gaming|soccer|sport|world cup|xbox)\b/],
  [
    'business & work',
    /\b(business|economy|finance|job|labor|money|tax|trade|work)\b/,
  ],
  [
    'politics & law',
    /\b(court|democracy|election|government|law|politics|senate|trump)\b/,
  ],
  ['culture & history', /\b(art|book|culture|film|history|music|reading)\b/],
];

/** A story's topic from its title, or `other`. */
export function topicOf(title: string): string {
  const text = title.toLowerCase();
  return (
    TOPIC_KEYWORDS.find(([, pattern]) => pattern.test(text))?.[0] ?? 'other'
  );
}

/** A title folded for spotting the same story twice. */
export function titleKey(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replaceAll(/[-/]/g, ' ')
    .replaceAll(/[^\p{L}\p{N}_\s]/gu, '')
    .replaceAll(/\s+/g, ' ');
}

/** The site a story or feed address is on, without `www.`. */
export function domainOf(url: string): string {
  try {
    return new URL(url.includes('://') ? url : `https://${url}`).hostname
      .toLowerCase()
      .replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Seconds a long story of `words` must be read for: a quarter of its time, 45s to 3m. */
export function neededSeconds(words: number): number {
  const estimated = Math.max(60, (words / 240) * 60);
  return Math.floor(Math.min(180, Math.max(45, estimated * 0.25)));
}

/** What the lists rank by. */
export type ListOrder = keyof typeof LIST_SIZE;

/** One story's activity in the window, as the repository gathers it. */
export interface Activity {
  readonly id: number;
  /** Seconds each person spent (one entry per reader); empty for saves. */
  readonly seconds: readonly number[];
  /** People who saved it in the window. */
  readonly savers: number;
  readonly words: number;
}

/** A story's place in a list: its count, and the keys it sorts by. */
export interface Ranked {
  readonly id: number;
  readonly count: number;
  readonly keys: readonly number[];
}

/**
 * Score a story for a list, or undefined when it does not make it. `count`
 * is what the API shows: people, or seconds for `read_time`.
 */
export function rank(order: ListOrder, a: Activity): Ranked | undefined {
  const capped = a.seconds.map((s) => Math.min(s, MAX_READ_SECONDS));
  const sum = (list: readonly number[]) => list.reduce((t, s) => t + s, 0);
  const second = (list: readonly number[]) =>
    list.toSorted((x, y) => y - x)[1] ?? 0;
  switch (order) {
    case 'reads': {
      return capped.length >= MIN_PEOPLE
        ? { id: a.id, count: capped.length, keys: [capped.length, sum(capped)] }
        : undefined;
    }
    case 'saves': {
      return a.savers >= MIN_PEOPLE
        ? { id: a.id, count: a.savers, keys: [a.savers] }
        : undefined;
    }
    case 'read_time': {
      const timed = capped.filter((s) => s >= MIN_READ_SECONDS);
      return timed.length >= MIN_PEOPLE
        ? { id: a.id, count: sum(timed), keys: [sum(timed), timed.length] }
        : undefined;
    }
    case 'long_reads': {
      if (a.words < MIN_LONG_WORDS) return undefined;
      const deep = capped.filter((s) => s >= neededSeconds(a.words));
      return deep.length >= MIN_PEOPLE
        ? { id: a.id, count: deep.length, keys: [second(deep), deep.length] }
        : undefined;
    }
    case 'good_reads': {
      if (a.words < MIN_GOOD_WORDS) return undefined;
      const deep = capped.filter((s) => s >= GOOD_READ_SECONDS);
      const qualifies =
        deep.length >= MIN_PEOPLE &&
        (a.savers >= 1 || deep.length >= GOOD_READ_FALLBACK_READERS);
      return qualifies
        ? {
            id: a.id,
            count: deep.length,
            keys: [a.savers ? 1 : 0, second(deep), deep.length],
          }
        : undefined;
    }
  }
}

/** Highest keys first, then the newer story. */
export function byRank(a: Ranked, b: Ranked): number {
  for (let i = 0; i < Math.max(a.keys.length, b.keys.length); i++) {
    const d = (b.keys[i] ?? 0) - (a.keys[i] ?? 0);
    if (d) return d;
  }
  return b.id - a.id;
}

/** What spreading a list out looks at for each story. */
export interface Candidate {
  readonly id: number;
  readonly source: number;
  readonly domain: string;
  readonly publisher: string;
  readonly topic: string;
  readonly cluster: number | null;
  readonly title: string;
  readonly followers: number;
}

/**
 * Spread a ranked list out, keeping its order otherwise: the same story
 * (cluster or title) shows once, each block of {@link BLOCK_SIZE} takes one
 * story per feed, site and publisher and at most {@link MAX_TOPIC_PER_BLOCK}
 * of a topic, and the rest wait for the next block. `smallSlots` stories
 * from small feeds lead each block.
 */
export function diversify<T extends Candidate>(
  ranked: readonly T[],
  smallSlots = 0,
): T[] {
  let remaining = [...ranked];
  const out: T[] = [];
  const clusters = new Set<number>();
  const titles = new Set<string>();
  while (remaining.length > 0) {
    const block: T[] = [];
    const deferred: T[] = [];
    const sources = new Set<number>();
    const domains = new Set<string>();
    const publishers = new Set<string>();
    const topics = new Map<string, number>();
    const small = smallSlots
      ? remaining
          .filter((c) => c.followers > 0 && c.followers <= SMALL_FEED_FOLLOWERS)
          .slice(0, smallSlots)
      : [];
    const ordered = [...small, ...remaining.filter((c) => !small.includes(c))];
    for (const c of ordered) {
      if (c.cluster !== null && clusters.has(c.cluster)) continue;
      if (c.title && titles.has(c.title)) continue;
      const capped = c.topic !== 'other';
      if (
        block.length >= BLOCK_SIZE ||
        sources.has(c.source) ||
        (c.domain && domains.has(c.domain)) ||
        (c.publisher && publishers.has(c.publisher)) ||
        (capped && (topics.get(c.topic) ?? 0) >= MAX_TOPIC_PER_BLOCK)
      ) {
        deferred.push(c);
        continue;
      }
      block.push(c);
      sources.add(c.source);
      if (c.domain) domains.add(c.domain);
      if (c.publisher) publishers.add(c.publisher);
      if (capped) topics.set(c.topic, (topics.get(c.topic) ?? 0) + 1);
      if (c.cluster !== null) clusters.add(c.cluster);
      if (c.title) titles.add(c.title);
    }
    if (block.length === 0) break;
    out.push(...block);
    remaining = deferred;
  }
  return capSourceShare(out);
}

/**
 * Drop the lowest-ranked repeats until no feed, site or publisher holds more
 * than {@link MAX_SOURCE_SHARE} of a list of ten or more.
 */
export function capSourceShare<T extends Candidate>(list: readonly T[]): T[] {
  let capped = [...list];
  const fields = ['source', 'domain', 'publisher'] as const;
  while (capped.length >= 10) {
    const limit = Math.max(1, Math.floor(capped.length * MAX_SOURCE_SHARE));
    const counts = fields.map((field) => {
      const seen = new Map<unknown, number>();
      for (const c of capped) {
        if (c[field]) seen.set(c[field], (seen.get(c[field]) ?? 0) + 1);
      }
      return seen;
    });
    if (counts.every((seen) => [...seen.values()].every((n) => n <= limit))) {
      break;
    }
    const kept = fields.map(() => new Map<unknown, number>());
    const filtered = capped.filter((c) => {
      if (fields.some((f, i) => c[f] && (kept[i]!.get(c[f]) ?? 0) >= limit)) {
        return false;
      }
      fields.forEach((f, i) => {
        if (c[f]) kept[i]!.set(c[f], (kept[i]!.get(c[f]) ?? 0) + 1);
      });
      return true;
    });
    if (filtered.length === capped.length) break;
    capped = filtered;
  }
  return capped;
}

/** How much a follow `daysAgo` counts for, over a window of `days`. */
export function decayWeight(days: number, daysAgo: number): number {
  const tables: Record<number, readonly number[]> = {
    1: [1],
    7: [1, 0.85, 0.7, 0.55, 0.4, 0.3, 0.2],
    30: [
      1, 0.97, 0.93, 0.9, 0.87, 0.83, 0.8, 0.77, 0.73, 0.7, 0.67, 0.63, 0.6,
      0.57, 0.53, 0.5, 0.47, 0.43, 0.4, 0.37, 0.33, 0.3, 0.27, 0.23, 0.2, 0.17,
      0.13, 0.1, 0.07, 0.03,
    ],
  };
  const table = tables[days];
  if (table) return table[daysAgo] ?? 0;
  if (daysAgo >= days) return 0;
  return Math.max(0.03, 1 - (daysAgo * 0.97) / Math.max(days - 1, 1));
}
