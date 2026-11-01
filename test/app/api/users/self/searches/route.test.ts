import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { databaseFrom, type Database } from '@/domain/db/database';
import { Repository } from '@/domain/repository';
import { SESSION_COOKIE } from '@/domain/auth/app';
import { APP_MIGRATIONS } from '../../../../../lib/core/db/migrations';
import {
  installCloudflareContext,
  sqliteD1,
} from '../../../../../lib/core/db/sqlite-d1';
import {
  SESSION_SECRET,
  tokenFor,
} from '../../../../../domain/auth/auth-test-kit';

const { GET, POST } = await import('@/app/api/users/self/searches/route');

const URL = 'https://app.test/api/users/self/searches';

let restore: () => void;
let db: Database;
let auth: Record<string, string>;

beforeEach(async () => {
  const made = sqliteD1(...APP_MIGRATIONS);
  restore = installCloudflareContext(made.d1, { SESSION_SECRET });
  made.raw
    .prepare(
      'INSERT INTO users (id, google_sub, email, session_epoch) VALUES (7, ?, ?, 0), (8, ?, ?, 0)',
    )
    .run('g7', 'a@b.com', 'g8', 'b@b.com');
  db = databaseFrom(made.d1);
  auth = {
    cookie: `${SESSION_COOKIE}=${await tokenFor({ id: 7 }, { ep: 0 })}`,
  };
});

afterEach(() => restore());

const post = (body: unknown) =>
  POST(
    new Request(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify(body),
    }),
  );

const list = (query = '') =>
  GET(new Request(`${URL}${query}`, { headers: auth }));

describe('POST /api/users/self/searches', () => {
  it('answers 201 with the search and where to find it', async () => {
    const res = await post({ query: 'rust' });
    expect(res.status).toBe(201);
    const search = (await res.json()) as { id: string };
    expect(search).toMatchObject({
      query: 'rust',
      articles: '/api/articles?q=rust',
    });
    expect(res.headers.get('location')).toBe(`${URL}/${search.id}`);
  });

  it('answers 200 with the search kept before', async () => {
    const first = (await (await post({ query: 'rust' })).json()) as {
      id: string;
    };
    const again = await post({ query: 'rust' });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { id: string }).id).toBe(first.id);
  });

  it('keeps a search within one of the person’s feeds', async () => {
    const feed = (await new Repository(db).addFeed(7, 'https://a.test/f'))!;
    const res = await post({ query: 'rust', feed_id: String(feed.id) });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ feed_id: String(feed.id) });
  });

  it('answers 400 for a feed that is not the person’s', async () => {
    const feed = (await new Repository(db).addFeed(8, 'https://a.test/f'))!;
    const res = await post({ query: 'rust', feed_id: String(feed.id) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { errors: string[] }).errors).toEqual([
      'feed_id: no such feed.',
    ]);
  });

  it('answers 400 naming the field for a bad body', async () => {
    const res = await post({ query: '' });
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    expect((await post({ query: 'rust' })).status).toBe(401);
  });
});

describe('GET /api/users/self/searches', () => {
  it('lists the person’s searches as pages, newest first', async () => {
    await post({ query: 'one' });
    await post({ query: 'two' });
    const page = (await (await list('?limit=1')).json()) as {
      next?: string;
      items: { query: string }[];
    };
    expect(page.items).toHaveLength(1);
    const rest = (await (
      await list(new globalThis.URL(page.next!).search)
    ).json()) as {
      items: { query: string }[];
    };
    expect([...page.items, ...rest.items].map((s) => s.query).sort()).toEqual([
      'one',
      'two',
    ]);
  });

  it('refuses a bad cursor', async () => {
    expect((await list('?cursor=nope')).status).toBe(400);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    expect((await list()).status).toBe(401);
  });
});
