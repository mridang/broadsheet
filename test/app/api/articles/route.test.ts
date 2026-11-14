import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { databaseFrom } from '@/domain/db/client';
import { Repository } from '@/domain/repository';
import { SESSION_COOKIE } from '@/domain/auth/app';
import { APP_MIGRATIONS } from '../../../lib/core/db/migrations';
import {
  installCloudflareContext,
  sqliteD1,
} from '../../../lib/core/db/sqlite-d1';
import { SESSION_SECRET, tokenFor } from '../../../domain/auth/auth-test-kit';

const { GET } = await import('@/app/api/articles/route');
const { POST: READ } =
  await import('@/app/api/users/self/reads/[article_id]/route');

let restore: () => void;
let auth: Record<string, string>;

beforeEach(async () => {
  const made = sqliteD1(...APP_MIGRATIONS);
  restore = installCloudflareContext(made.d1, { SESSION_SECRET });
  made.raw
    .prepare(
      'INSERT INTO users (id, google_sub, email, session_epoch) VALUES (7, ?, ?, 0), (8, ?, ?, 0)',
    )
    .run('g7', 'a@b.com', 'g8', 'b@b.com');
  const repo = new Repository(databaseFrom(made.d1));
  const { source_id } = (await repo.addFeed(7, 'https://a.test/f'))!;
  await repo.addFeed(8, 'https://a.test/f');
  await repo.writeEdition(
    source_id,
    '2026-10-01',
    [1, 2, 3].map((n) => ({
      url: `https://x/${n}`,
      title: n === 2 ? 'Go news' : `Rust news ${n}`,
      source: '',
      favicon: '',
      summary: '',
      image: '',
      published_at: '',
      points: 0,
      body_text: 'secret text',
    })),
  );
  auth = {
    cookie: `${SESSION_COOKIE}=${await tokenFor({ id: 7 }, { ep: 0 })}`,
  };
});

afterEach(() => restore());

const get = (query: string, headers = auth) =>
  GET(new Request(`https://app.test/api/articles${query}`, { headers }));

interface Page {
  self: string;
  next?: string;
  items: { title: string; body_text?: string }[];
}

describe('GET /api/articles', () => {
  it('finds articles holding the words, newest first, without their text', async () => {
    const res = await get('?q=rust');
    expect(res.status).toBe(200);
    const page = (await res.json()) as Page;
    expect(page.self).toBe('https://app.test/api/articles?q=rust');
    expect(page.items.map((a) => a.title)).toEqual([
      'Rust news 3',
      'Rust news 1',
    ]);
    expect(page.items[0]).not.toHaveProperty('body_text');
    expect(page).not.toHaveProperty('next');
  });

  it('links the next page with a cursor', async () => {
    const firstRes = await get('?limit=2');
    const first = (await firstRes.json()) as Page;
    expect(first.items).toHaveLength(2);
    const next = new URL(first.next!);
    const restRes = await get(next.search);
    const rest = (await restRes.json()) as Page;
    expect(rest.items.map((a) => a.title)).toEqual(['Rust news 1']);
  });

  it('refuses a bad parameter as a problem', async () => {
    const res = await get('?cursor=nope');
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('problem+json');
  });

  it('refuses a caller who is not signed in', async () => {
    const res = await get('', {});
    expect(res.status).toBe(401);
  });
});

describe('GET /api/articles?order=reads', () => {
  /** Note `id` as read by person `uid`. */
  const readAs = async (uid: number, id: number) =>
    READ(
      new Request(`https://app.test/api/users/self/reads/${id}`, {
        method: 'POST',
        headers: {
          cookie: `${SESSION_COOKIE}=${await tokenFor({ id: uid }, { ep: 0 })}`,
        },
      }),
      { params: Promise.resolve({ article_id: String(id) }) },
    );

  it('ranks by distinct readers with counts only, paging with a cursor', async () => {
    const firstRes = await get('?limit=3');
    const first = (await firstRes.json()) as {
      items: { id: string }[];
    };
    const ids = first.items.map((a) => Number(a.id));
    for (const id of ids.slice(0, 2)) {
      await readAs(7, id);
      await readAs(8, id);
    }
    const res = await get('?order=reads&window=day&limit=1');
    expect(res.status).toBe(200);
    const page = (await res.json()) as Page & {
      items: Record<string, unknown>[];
    };
    expect(page.items).toHaveLength(1);
    expect(Object.keys(page.items[0]!)).not.toContain('user_id');
    expect(page.items[0]).toMatchObject({ read_count: 2 });
    const nextRes = await GET(new Request(page.next!, { headers: auth }));
    const next = (await nextRes.json()) as Page;
    expect(next.items).toHaveLength(1);
    expect(next).not.toHaveProperty('next');
  });

  it('never lists a story only one person read', async () => {
    const firstRes = await get('?limit=1');
    const first = (await firstRes.json()) as {
      items: { id: string }[];
    };
    await readAs(8, Number(first.items[0]!.id));
    const pageRes = await get('?order=reads');
    const page = (await pageRes.json()) as Page;
    expect(page.items).toEqual([]);
  });

  it('leaves out what the caller read with read=false', async () => {
    const firstRes = await get('?limit=1');
    const first = (await firstRes.json()) as {
      items: { id: string }[];
    };
    const id = Number(first.items[0]!.id);
    await readAs(7, id);
    await readAs(8, id);
    const pageRes = await get('?order=reads&read=false');
    const page = (await pageRes.json()) as Page;
    expect(page.items).toEqual([]);
  });

  it('answers 400 for an order it does not know', async () => {
    const res = await get('?order=popular');
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });
});
