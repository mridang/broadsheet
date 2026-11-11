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
import type { Database } from '@/domain/db/database';
import { Repository, type Clusterable } from '@/domain/repository';
import {
  MIN_TITLE_LENGTH,
  fuzzyMatch,
  normaliseTitle,
  relatedMatch,
  significantWords,
} from '@/domain/titles';
import { logInfo } from '@/utils/logging';

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
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Union-find over indexes, refusing a union that would pass `cap` members. */
class Groups {
  readonly #parent: number[];
  readonly #size: number[];

  constructor(
    n: number,
    readonly cap: number,
  ) {
    this.#parent = Array.from({ length: n }, (_, i) => i);
    this.#size = Array.from({ length: n }, () => 1);
  }

  rootOf(i: number): number {
    let root = i;
    while (this.#parent[root] !== root) root = this.#parent[root] ?? root;
    this.#parent[i] = root;
    return root;
  }

  union(i: number, j: number): void {
    const a = this.rootOf(i);
    const b = this.rootOf(j);
    if (a === b) return;
    const size = (this.#size[a] ?? 1) + (this.#size[b] ?? 1);
    if (size > this.cap) return;
    this.#parent[b] = a;
    this.#size[a] = size;
  }
}

/** Every pair of items that share a title word not too common to count. */
function candidatePairs(words: readonly Set<string>[]): [number, number][] {
  const index = new Map<string, number[]>();
  words.forEach((set, i) => {
    for (const w of set) index.set(w, [...(index.get(w) ?? []), i]);
  });
  // Keyed by pair, so a pair found twice keeps its first place and is kept once.
  const seen = new Map<string, [number, number]>();
  for (const members of index.values()) {
    if (members.length > COMMON_WORD) continue;
    for (let x = 0; x < members.length; x++) {
      for (let y = x + 1; y < members.length; y++) {
        const i = members[x] ?? 0;
        const j = members[y] ?? 0;
        seen.set(`${i}:${j}`, [i, j]);
      }
    }
  }
  return [...seen.values()];
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
  const groups = new Groups(items.length, MAX_CLUSTER);
  const exact = new Map<string, number>();
  items.forEach((it, i) => {
    const key = normaliseTitle(it.title);
    if (key.length < MIN_TITLE_LENGTH) return;
    const first = exact.get(key);
    if (first === undefined) exact.set(key, i);
    else groups.union(first, i);
  });
  for (const [i, j] of candidatePairs(words)) {
    const a = items[i];
    const b = items[j];
    if (!a || !b || a.source_id === b.source_id) continue;
    const wa = words[i] ?? new Set<string>();
    const wb = words[j] ?? new Set<string>();
    const close =
      a.vector && b.vector && cosine(a.vector, b.vector) >= threshold;
    if (fuzzyMatch(wa, wb) || (close && relatedMatch(wa, wb))) {
      groups.union(i, j);
    }
  }
  const byRoot = new Map<number, number[]>();
  items.forEach((_, i) => {
    const root = groups.rootOf(i);
    byRoot.set(root, [...(byRoot.get(root) ?? []), i]);
  });
  return [...byRoot.values()]
    .filter(
      (members) => new Set(members.map((i) => items[i]?.source_id)).size > 1,
    )
    .map((members) => members.map((i) => items[i]?.id ?? 0));
}

/** What an article is embedded from: its title and the start of its summary. */
export function embeddingText(a: Clusterable): string {
  return `${a.title ?? ''}\n${(a.summary ?? '').slice(0, 400)}`.trim();
}

/** Cut `list` into runs of at most `size`. */
function batches<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** The vectors Vectorize already holds for these articles, by id. */
async function storedVectors(
  index: VectorizeIndex,
  ids: readonly number[],
): Promise<Map<number, number[]>> {
  const found = new Map<number, number[]>();
  for (const part of batches(ids, LOOKUP_BATCH)) {
    // Vectorize's getByIds, not Testing Library's sync query of that name.
    // eslint-disable-next-line testing-library/no-await-sync-queries -- Vectorize's getByIds is an async API of the index binding (name not ours to change); the preset applies this Testing Library rule to non-test source, which is a false positive
    for (const v of await index.getByIds(part.map(String))) {
      found.set(Number(v.id), [...v.values]);
    }
  }
  return found;
}

/** Embed articles with Workers AI and store their vectors in Vectorize. */
async function embedAll(
  env: CloudflareEnv,
  index: VectorizeIndex,
  articles: readonly Clusterable[],
  edition: string,
): Promise<Map<number, number[]>> {
  const made = new Map<number, number[]>();
  for (const part of batches(articles, EMBED_BATCH)) {
    const out = await env.AI.run(EMBEDDING_MODEL, {
      text: part.map((a) => embeddingText(a)),
    });
    const data = 'data' in out ? (out.data ?? []) : [];
    const vectors = part.flatMap((a, i) => {
      const values = data[i];
      return values ? [{ a, values }] : [];
    });
    if (vectors.length === 0) continue;
    await index.upsert(
      vectors.map(({ a, values }) => ({
        id: String(a.id),
        values,
        metadata: { edition, source_id: a.source_id },
      })),
    );
    vectors.forEach(({ a, values }) => made.set(a.id, values));
  }
  return made;
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
  const vectors = await storedVectors(
    index,
    articles.map((a) => a.id),
  );
  const fresh = articles.filter((a) => !vectors.has(a.id));
  for (const [id, values] of await embedAll(env, index, fresh, edition)) {
    vectors.set(id, values);
  }
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
