/**
 * @packageDocumentation
 *
 * Finding the same story told by different sources, in NewsBlur's two tiers.
 * Titles first: two stories whose titles normalise the same, or share most of
 * their significant words, are one story (a same-source copy with the same
 * title joins too). Then meaning: each article is embedded once with Workers
 * AI and its vector kept in Vectorize (keyed by article id, so a rerun only
 * embeds what is new), and stories from different sources whose vectors are
 * close join when their titles also share enough words. Candidate pairs come
 * from an index of shared title words, skipping words too common to tell
 * stories apart. Matches merge by union-find into clusters of at most
 * {@link MAX_CLUSTER} spanning two or more sources.
 */
import { Repository } from '@/domain/repository';
import {
  MIN_TITLE_LENGTH,
  fuzzyMatch,
  normaliseTitle,
  relatedMatch,
  significantWords,
} from '@/domain/titles';
import { logInfo } from '@/utils/logging';
import type { Clusterable } from '@/domain/repository';
import type { Database } from '@/domain/db/client';

/** The Workers AI model articles are embedded with (768 dimensions). */
export const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';

/** How similar (cosine) two articles must be to count as one story. */
export const SAME_STORY = 0.86;

/** How many days back a story may find its copies (NewsBlur's 120 hours). */
export const LOOKBACK_DAYS = 5;
/** How many days a cluster is kept before it is forgotten. */
export const CLUSTER_TTL_DAYS = 14;

/** `days` days before a YYYY-MM-DD date. */
export function daysBefore(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** The most stories one cluster holds. */
export const MAX_CLUSTER = 10;

/** A title word in more stories than this is too common to pair them by. */
const COMMON_WORD = 50;

/** Texts per embedding request, and ids per Vectorize lookup. */
const EMBED_BATCH = 50;
const LOOKUP_BATCH = 20;

/** An article as clustering compares it: its title, source and embedding. */
export interface ClusterItem {
  readonly id: number;
  readonly source_id: number;
  readonly title: string | null;
  readonly feed_title?: string | null;
  readonly vector?: readonly number[];
}

/** The cosine similarity of two vectors (0 when either is all zeros). */
export function cosine(a: readonly number[], b: readonly number[]): number {
  const terms = Array.from(
    { length: Math.min(a.length, b.length) },
    (_, index) => ({
      x: a[index] ?? 0,
      y: b[index] ?? 0,
    }),
  );
  const dot = terms.reduce((sum, { x, y }) => sum + x * y, 0);
  const na = terms.reduce((sum, { x }) => sum + x * x, 0);
  const nb = terms.reduce((sum, { y }) => sum + y * y, 0);
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Union-find over indexes, refusing a union that would pass `cap` members. */
class Groups {
  readonly #parent: readonly number[];
  readonly #size: readonly number[];

  private constructor(
    parent: readonly number[],
    size: readonly number[],
    readonly cap: number,
  ) {
    this.#parent = parent;
    this.#size = size;
  }

  static of(n: number, cap: number): Groups {
    return new Groups(
      Array.from({ length: n }, (_, index) => index),
      Array.from({ length: n }, () => 1),
      cap,
    );
  }

  rootOf(index: number): number {
    const parent = this.#parent[index] ?? index;
    return parent === index ? index : this.rootOf(parent);
  }

  union(index: number, index6: number): Groups {
    const a = this.rootOf(index);
    const b = this.rootOf(index6);
    if (a === b) {
      return this;
    }
    const size = (this.#size[a] ?? 1) + (this.#size[b] ?? 1);
    if (size > this.cap) {
      return this;
    }
    return new Groups(
      this.#parent.with(b, a),
      this.#size.with(a, size),
      this.cap,
    );
  }
}

/** Every pair of items that share a title word not too common to count. */
function candidatePairs(words: readonly Set<string>[]): [number, number][] {
  const index = Map.groupBy(
    words.flatMap((set, at) => Array.from(set, (w) => ({ w, at }))),
    ({ w }) => w,
  );
  // Keyed by pair, so a pair found twice keeps its first place and is kept once.
  const pairs = index
    .values()
    .map((group) => group.map(({ at }) => at))
    .filter((members) => members.length <= COMMON_WORD)
    .flatMap((members) =>
      members.flatMap((first, x) =>
        members.slice(x + 1).map((second): [number, number] => [first, second]),
      ),
    )
    .toArray();
  return [
    ...new Map(pairs.map((pair) => [`${pair[0]}:${pair[1]}`, pair])).values(),
  ];
}

/**
 * Group the same story told more than once. Exact titles join whatever their
 * source; fuzzy titles and close embeddings (at least `threshold` similar,
 * confirmed by shared title words) join only across sources. Returns groups
 * of article ids that span two or more sources, each at most
 * {@link MAX_CLUSTER} long.
 */
export function clusterGroups(
  items: readonly ClusterItem[],
  threshold: number = SAME_STORY,
): number[][] {
  const words = items.map((it) => significantWords(it.title, it.feed_title));
  const keys = items.map((it) => normaliseTitle(it.title));
  const firstOf = new Map(
    keys.map((key, index): [string, number] => [key, index]).toReversed(),
  );
  const exactPairs = keys.flatMap((key, index): [number, number][] => {
    const first = firstOf.get(key);
    return key.length >= MIN_TITLE_LENGTH &&
      first !== undefined &&
      first !== index
      ? [[first, index]]
      : [];
  });
  const fuzzyPairs = candidatePairs(words).filter(([index, index3]) => {
    const a = items[index];
    const b = items[index3];
    if (!a || !b || a.source_id === b.source_id) {
      return false;
    }
    const wa = words[index] ?? new Set<string>();
    const wb = words[index3] ?? new Set<string>();
    const close =
      a.vector && b.vector && cosine(a.vector, b.vector) >= threshold;
    return fuzzyMatch(wa, wb) || (close === true && relatedMatch(wa, wb));
  });
  const groups = [exactPairs, fuzzyPairs]
    .flat()
    .reduce(
      (merged, [first, second]) => merged.union(first, second),
      Groups.of(items.length, MAX_CLUSTER),
    );
  const byRoot = Map.groupBy([...items.keys()], (index) =>
    groups.rootOf(index),
  );
  return byRoot
    .values()
    .filter(
      (members) =>
        new Set(members.map((index) => items[index]?.source_id)).size > 1,
    )
    .map((members) => members.map((index) => items[index]?.id ?? 0))
    .toArray();
}

/** What an article is embedded from: its title and the start of its summary. */
export function embeddingText(a: Clusterable): string {
  return `${a.title ?? ''}\n${(a.summary ?? '').slice(0, 400)}`.trim();
}

/** Cut `list` into runs of at most `size`. */
function batches<T>(list: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(list.length / size) }, (_, index) =>
    list.slice(index * size, (index + 1) * size),
  );
}

/** The vectors Vectorize already holds for these articles, by id. */
async function storedVectors(
  index: VectorizeIndex,
  ids: readonly number[],
): Promise<Map<number, number[]>> {
  return batches(ids, LOOKUP_BATCH).reduce(async (previous, part) => {
    const found = await previous;
    // Vectorize's getByIds, not Testing Library's sync query of that name.

    const rows = await index.getByIds(part.map(String));
    return new Map(
      [
        [...found],
        rows.map((v): [number, number[]] => [Number(v.id), [...v.values]]),
      ].flat(),
    );
  }, Promise.resolve(new Map<number, number[]>()));
}

/** Embed articles with Workers AI and store their vectors in Vectorize. */
async function embedAll(
  env: CloudflareEnv,
  index: VectorizeIndex,
  articles: readonly Clusterable[],
  edition: string,
): Promise<Map<number, number[]>> {
  return batches(articles, EMBED_BATCH).reduce(async (previous, part) => {
    const made = await previous;
    const out = await env.AI.run(EMBEDDING_MODEL, {
      text: part.map((a) => embeddingText(a)),
    });
    const data = 'data' in out ? (out.data ?? []) : [];
    const vectors = part.flatMap((a, index2) => {
      const values = data[index2];
      return values ? [{ a, values }] : [];
    });
    if (vectors.length === 0) {
      return made;
    }
    await index.upsert(
      vectors.map(({ a, values }) => ({
        id: String(a.id),
        values,
        metadata: { edition, source_id: a.source_id },
      })),
    );
    return new Map(
      [
        [...made],
        vectors.map(({ a, values }): [number, number[]] => [a.id, values]),
      ].flat(),
    );
  }, Promise.resolve(new Map<number, number[]>()));
}

/**
 * Cluster one edition with the days before it (the last
 * {@link LOOKBACK_DAYS} editions), so a story finds the copies published
 * the day before: embed the articles Vectorize does not hold yet, group the
 * window and store its clusters, and forget clusters older than
 * {@link CLUSTER_TTL_DAYS} days. Returns how many articles
 * were compared and how many clusters were found. Clustering is off until the
 * Vectorize binding is added: with none, nothing is embedded or compared.
 */
export async function clusterEdition(
  db: Database,
  env: CloudflareEnv,
  edition: string,
): Promise<{ articles: number; clusters: number }> {
  const index = env.VECTORIZE;
  if (!index) {
    logInfo({ event: 'cluster.skipped', edition, reason: 'no index' });
    return { articles: 0, clusters: 0 };
  }
  const repo = new Repository(db);
  const from = daysBefore(edition, LOOKBACK_DAYS - 1);
  const articles = await repo.windowArticles(from, edition);
  const stored = await storedVectors(
    index,
    articles.map((a) => a.id),
  );
  const fresh = articles.filter((a) => !stored.has(a.id));
  const vectors = new Map(
    [[...stored], [...(await embedAll(env, index, fresh, edition))]].flat(),
  );
  const groups = clusterGroups(
    articles.map((a) => {
      const vector = vectors.get(a.id);
      return { ...a, ...(vector ? { vector } : {}) };
    }),
  );
  await repo.writeWindowClusters(from, edition, groups);
  const expired = await repo.expireClusters(
    daysBefore(edition, CLUSTER_TTL_DAYS),
  );
  logInfo({
    event: 'cluster.completed',
    edition,
    expired,
    articles: articles.length,
    embedded: fresh.length,
    clusters: groups.length,
  });
  return { articles: articles.length, clusters: groups.length };
}
