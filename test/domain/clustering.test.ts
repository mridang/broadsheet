import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  clusterEdition,
  cosine,
  embeddingText,
  CLUSTER_TTL_DAYS,
  LOOKBACK_DAYS,
  MAX_CLUSTER,
  daysBefore,
  clusterGroups,
} from '@/domain/clustering';
import { databaseFrom, type Database } from '@/domain/db/client';
import { Repository } from '@/domain/repository';
import { APP_MIGRATIONS } from '../lib/core/db/migrations';
import { sqliteD1 } from '../lib/core/db/sqlite-d1';

describe('cosine', () => {
  it('is 1 for the same direction', () => {
    expect(cosine([1, 2], [2, 4])).toBeCloseTo(1);
  });

  it('is 0 for orthogonal vectors', () => {
    expect(cosine([1, 0], [0, 1])).toBe(0);
  });

  it('is 0 when a vector is all zeros', () => {
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
});

const QUAKE = 'Powerful earthquake strikes coastal city overnight';

describe('clusterGroups', () => {
  it('joins the same headline from two sources without embeddings', () => {
    expect(
      clusterGroups([
        { id: 1, source_id: 1, title: QUAKE },
        { id: 2, source_id: 2, title: `${QUAKE}!` },
        { id: 3, source_id: 3, title: 'Local team wins the cup final' },
      ]),
    ).toEqual([[1, 2]]);
  });

  it('folds a same-source copy with the same headline into the cluster', () => {
    expect(
      clusterGroups([
        { id: 1, source_id: 1, title: QUAKE },
        { id: 2, source_id: 1, title: QUAKE },
        { id: 3, source_id: 2, title: QUAKE },
      ]),
    ).toEqual([[1, 2, 3]]);
  });

  it('keeps the same headline twice from one source alone', () => {
    expect(
      clusterGroups([
        { id: 1, source_id: 1, title: QUAKE },
        { id: 2, source_id: 1, title: QUAKE },
      ]),
    ).toEqual([]);
  });

  it('ignores an exact match on a headline too short to tell', () => {
    expect(
      clusterGroups([
        { id: 1, source_id: 1, title: 'Updates' },
        { id: 2, source_id: 2, title: 'Updates' },
      ]),
    ).toEqual([]);
  });

  it('joins headlines that share most of their words across sources', () => {
    expect(
      clusterGroups([
        {
          id: 1,
          source_id: 1,
          title: 'Apple unveils new iPhone camera battery design',
        },
        {
          id: 2,
          source_id: 2,
          title: 'Apple unveils iPhone with new camera and battery',
        },
      ]),
    ).toEqual([[1, 2]]);
  });

  it('does not join a fuzzy match from one source', () => {
    expect(
      clusterGroups([
        {
          id: 1,
          source_id: 1,
          title: 'Apple unveils new iPhone camera battery design',
        },
        {
          id: 2,
          source_id: 1,
          title: 'Apple unveils iPhone with new camera and battery',
        },
      ]),
    ).toEqual([]);
  });

  it('joins close embeddings whose headlines share enough words', () => {
    expect(
      clusterGroups([
        {
          id: 1,
          source_id: 1,
          title: 'Central bank raises interest rates sharply amid inflation',
          vector: [1, 0],
        },
        {
          id: 2,
          source_id: 2,
          title: 'Rates rise again as central bank fights inflation pressure',
          vector: [0.99, 0.05],
        },
      ]),
    ).toEqual([[1, 2]]);
  });

  it('refuses close embeddings whose headlines share too little', () => {
    expect(
      clusterGroups([
        {
          id: 1,
          source_id: 1,
          title: 'Central bank raises rates',
          vector: [1, 0],
        },
        {
          id: 2,
          source_id: 2,
          title: 'Markets tumble on the news',
          vector: [1, 0],
        },
      ]),
    ).toEqual([]);
  });

  it('refuses embeddings below the threshold', () => {
    const items = [
      {
        id: 1,
        source_id: 1,
        title: 'Central bank raises interest rates sharply amid inflation',
        vector: [1, 0],
      },
      {
        id: 2,
        source_id: 2,
        title: 'Rates rise again as central bank fights inflation pressure',
        vector: [1, 1],
      },
    ];
    expect(clusterGroups(items, 0.9)).toEqual([]);
    expect(clusterGroups(items, 0.7)).toEqual([[1, 2]]);
  });

  it('leaves out the words of the feed’s own name', () => {
    expect(
      clusterGroups([
        {
          id: 1,
          source_id: 1,
          title: 'Daily Planet Daily Planet news roundup today',
          feed_title: 'Daily Planet',
        },
        {
          id: 2,
          source_id: 2,
          title: 'Daily Planet weather roundup sport today',
          feed_title: 'Daily Planet',
        },
      ]),
    ).toEqual([]);
  });

  it(`holds at most ${MAX_CLUSTER} stories in one cluster`, () => {
    const many = Array.from({ length: MAX_CLUSTER + 3 }, (_, i) => ({
      id: i + 1,
      source_id: i + 1,
      title: QUAKE,
    }));
    const groups = clusterGroups(many);
    expect(groups[0]).toHaveLength(MAX_CLUSTER);
    expect(groups.every((g) => g.length <= MAX_CLUSTER)).toBe(true);
  });
});

describe('embeddingText', () => {
  it('joins the title and the start of the summary', () => {
    expect(
      embeddingText({
        id: 1,
        source_id: 1,
        title: 'T',
        summary: 'x'.repeat(500),
        feed_title: null,
      }),
    ).toBe(`T\n${'x'.repeat(400)}`);
  });

  it('copes with neither', () => {
    expect(
      embeddingText({
        id: 1,
        source_id: 1,
        title: null,
        summary: null,
        feed_title: null,
      }),
    ).toBe('');
  });
});

describe('clusterEdition', () => {
  let db: Database;
  let repo: Repository;

  beforeEach(async () => {
    db = databaseFrom(sqliteD1(...APP_MIGRATIONS).d1);
    repo = new Repository(db);
    const user = await repo.upsertUser({ sub: 'g', email: 'a@b.c' });
    for (const n of [1, 2]) {
      const f = await repo.addFeed(user.id, `https://s${n}.test/rss`);
      await repo.writeEdition(f!.source_id, '2026-11-01', [
        {
          url: `https://s${n}.test/quake`,
          title: 'Earthquake hits city',
          source: `S${n}`,
          favicon: '',
          summary: '',
          image: '',
          published_at: '',
          points: 0,
        },
        {
          url: `https://s${n}.test/other${n}`,
          title: `Other ${n}`,
          source: `S${n}`,
          favicon: '',
          summary: '',
          image: '',
          published_at: '',
          points: 0,
        },
      ]);
    }
  });

  /** An env whose model embeds by title and whose index starts empty. */
  function env(stored: Map<string, number[]> = new Map()) {
    const upsert = jest.fn(
      async (vectors: { id: string; values: number[] }[]) => {
        vectors.forEach((v) => stored.set(v.id, v.values));
        return { ids: [], count: vectors.length };
      },
    );
    const run = jest.fn(async (_model: string, input: { text: string[] }) => ({
      data: input.text.map((t) => {
        if (t.startsWith('Earthquake')) return [1, 0, 0];
        return t.endsWith('1') ? [0, 1, 0] : [0, 0, 1];
      }),
    }));
    const getByIds = jest.fn(async (ids: string[]) =>
      ids.flatMap((id) => {
        const values = stored.get(id);
        return values ? [{ id, values }] : [];
      }),
    );
    return {
      upsert,
      run,
      env: {
        AI: { run },
        VECTORIZE: { upsert, getByIds },
      } as unknown as CloudflareEnv,
    };
  }

  it('clusters the same story from two sources and leaves the rest alone', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const { env: e } = env();
    expect(await clusterEdition(db, e, '2026-11-01')).toEqual({
      articles: 4,
      clusters: 1,
    });
    const editionRows = await repo.editionArticles('2026-11-01');
    const rows = await repo.articlesByIds(editionRows.map((a) => a.id));
    const quakes = rows.filter((a) => a.title === 'Earthquake hits city');
    expect(new Set(quakes.map((a) => a.cluster_id)).size).toBe(1);
    expect(quakes[0]?.cluster_id).not.toBeNull();
    expect(rows.filter((a) => a.cluster_id === null)).toHaveLength(2);
  });

  it('embeds only the articles the index does not hold yet', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const stored = new Map<string, number[]>();
    await clusterEdition(db, env(stored).env, '2026-11-01');
    const again = env(stored);
    await clusterEdition(db, again.env, '2026-11-01');
    expect(again.run).not.toHaveBeenCalled();
  });

  it('finds a copy published days before, within the lookback', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const feed = await repo.addFeed(1, 'https://s3.test/rss');
    await repo.writeEdition(feed!.source_id, '2026-11-03', [
      {
        url: 'https://s3.test/quake',
        title: 'Earthquake hits city',
        source: 'S3',
        favicon: '',
        summary: '',
        image: '',
        published_at: '',
        points: 0,
      },
    ]);
    await clusterEdition(db, env().env, '2026-11-03');
    const windowRows = await repo.windowArticles('2026-11-01', '2026-11-03');
    const quakes = windowRows
      .filter((a) => a.title === 'Earthquake hits city')
      .map((a) => a.id);
    const rows = await repo.articlesByIds(quakes);
    expect(new Set(rows.map((a) => a.cluster_id)).size).toBe(1);
    expect(rows).toHaveLength(3);
  });

  it('forgets clusters older than the time they are kept', async () => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    await clusterEdition(db, env().env, '2026-11-01');
    const later = daysBefore('2026-11-01', -CLUSTER_TTL_DAYS - 1);
    await clusterEdition(db, env().env, later);
    const editionRows = await repo.editionArticles('2026-11-01');
    const rows = await repo.articlesByIds(editionRows.map((a) => a.id));
    expect(rows.every((a) => a.cluster_id === null)).toBe(true);
  });

  it('skips clustering without embedding anything when no index is bound', async () => {
    const { run, env: e } = env();
    const unbound = Object.fromEntries(
      Object.entries(e).filter(([key]) => key !== 'VECTORIZE'),
    ) as CloudflareEnv;
    expect(await clusterEdition(db, unbound, '2026-11-01')).toEqual({
      articles: 0,
      clusters: 0,
    });
    expect(run).not.toHaveBeenCalled();
  });
});

describe('daysBefore', () => {
  it('steps back across a month', () => {
    expect(daysBefore('2026-11-02', LOOKBACK_DAYS)).toBe('2026-10-28');
  });
});
