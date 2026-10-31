/**
 * @packageDocumentation
 *
 * Finding the same story told by different sources. Each article of an
 * edition is embedded once with Workers AI and its vector kept in Vectorize
 * (keyed by article id), so a rerun only embeds what is new. The edition's
 * vectors are then compared in memory: articles from different sources whose
 * vectors are close enough form a cluster, which the paper prints once.
 */
import type { Database } from '@/domain/db/database';
import { Repository, type Clusterable } from '@/domain/repository';
import { logInfo } from '@/utils/logging';

/** The Workers AI model articles are embedded with (768 dimensions). */
export const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';

/** How similar (cosine) two articles must be to count as one story. */
export const SAME_STORY = 0.86;

/** Texts per embedding request, and ids per Vectorize lookup. */
const EMBED_BATCH = 50;
const LOOKUP_BATCH = 20;

/** An article and its embedding. */
export interface Embedded {
  readonly id: number;
  readonly source_id: number;
  readonly vector: readonly number[];
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

/**
 * Group near-duplicates: each article joins the first group whose first
 * member it is at least `threshold` similar to and that has nothing from its
 * own source yet, else starts a group. Only groups spanning two or more
 * sources are returned, as lists of article ids.
 */
export function groupNearDuplicates(
  items: readonly Embedded[],
  threshold: number = SAME_STORY,
): number[][] {
  const groups: Embedded[][] = [];
  for (const item of items) {
    const home = groups.find(
      (g) =>
        g[0] !== undefined &&
        cosine(g[0].vector, item.vector) >= threshold &&
        !g.some((m) => m.source_id === item.source_id),
    );
    if (home) home.push(item);
    else groups.push([item]);
  }
  return groups.filter((g) => g.length > 1).map((g) => g.map((m) => m.id));
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
    // eslint-disable-next-line testing-library/no-await-sync-queries
    for (const v of await index.getByIds(part.map(String))) {
      found.set(Number(v.id), Array.from(v.values));
    }
  }
  return found;
}

/** Embed articles with Workers AI and store their vectors in Vectorize. */
async function embedAll(
  env: CloudflareEnv,
  articles: readonly Clusterable[],
  edition: string,
): Promise<Map<number, number[]>> {
  const made = new Map<number, number[]>();
  for (const part of batches(articles, EMBED_BATCH)) {
    const out = await env.AI.run(EMBEDDING_MODEL, {
      text: part.map(embeddingText),
    });
    const data = 'data' in out ? (out.data ?? []) : [];
    const vectors = part.flatMap((a, i) => {
      const values = data[i];
      return values ? [{ a, values }] : [];
    });
    if (!vectors.length) continue;
    await env.VECTORIZE.upsert(
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
 * Cluster one edition: embed the articles Vectorize does not hold yet, then
 * group the whole edition and store the clusters. Returns how many articles
 * were compared and how many clusters were found.
 */
export async function clusterEdition(
  db: Database,
  env: CloudflareEnv,
  edition: string,
): Promise<{ articles: number; clusters: number }> {
  const repo = new Repository(db);
  const articles = await repo.editionArticles(edition);
  const vectors = await storedVectors(
    env.VECTORIZE,
    articles.map((a) => a.id),
  );
  const fresh = articles.filter((a) => !vectors.has(a.id));
  for (const [id, values] of await embedAll(env, fresh, edition)) {
    vectors.set(id, values);
  }
  const groups = groupNearDuplicates(
    articles.flatMap((a) => {
      const vector = vectors.get(a.id);
      return vector ? [{ id: a.id, source_id: a.source_id, vector }] : [];
    }),
  );
  await repo.writeClusters(edition, groups);
  logInfo({
    event: 'cluster.completed',
    edition,
    articles: articles.length,
    embedded: fresh.length,
    clusters: groups.length,
  });
  return { articles: articles.length, clusters: groups.length };
}
