import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { databaseFrom } from '@/domain/db/database';
import { Repository } from '@/domain/repository';
import { SESSION_COOKIE } from '@/domain/auth/app';
import { APP_MIGRATIONS } from '../../../lib/core/db/migrations';
import {
  installCloudflareContext,
  sqliteD1,
} from '../../../lib/core/db/sqlite-d1';
import { SESSION_SECRET, tokenFor } from '../../../domain/auth/auth-test-kit';

const { GET } = await import('@/app/api/articles/route');

let restore: () => void;
let auth: Record<string, string>;

beforeEach(async () => {
  const made = sqliteD1(...APP_MIGRATIONS);
  restore = installCloudflareContext(made.d1, { SESSION_SECRET });
  made.raw
    .prepare(
      'INSERT INTO users (id, google_sub, email, session_epoch) VALUES (7, ?, ?, 0)',
    )
    .run('g7', 'a@b.com');
  const repo = new Repository(databaseFrom(made.d1));
  const { source_id } = (await repo.addFeed(7, 'https://a.test/f'))!;
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
    const first = (await (await get('?limit=2')).json()) as Page;
    expect(first.items).toHaveLength(2);
    const next = new URL(first.next!);
    const rest = (await (await get(next.search)).json()) as Page;
    expect(rest.items.map((a) => a.title)).toEqual(['Rust news 1']);
  });

  it('refuses a bad parameter as a problem', async () => {
    const res = await get('?cursor=nope');
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('problem+json');
  });

  it('refuses a caller who is not signed in', async () => {
    expect((await get('', {})).status).toBe(401);
  });
});
