import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { databaseFrom, type Database } from '@/domain/db/client';
import { Repository } from '@/domain/repository';
import { SESSION_COOKIE } from '@/domain/auth/app';
import { APP_MIGRATIONS } from '../../../../../../../lib/core/db/migrations';
import {
  installCloudflareContext,
  sqliteD1,
} from '../../../../../../../lib/core/db/sqlite-d1';
import {
  SESSION_SECRET,
  tokenFor,
} from '../../../../../../../domain/auth/auth-test-kit';

const { PATCH, DELETE } =
  await import('@/app/api/users/self/saves/tags/[name]/route');

let restore: () => void;
let db: Database;
let story: number;
let auth: Record<string, string>;

async function cookieFor(uid: number): Promise<Record<string, string>> {
  return {
    cookie: `${SESSION_COOKIE}=${await tokenFor({ id: uid }, { ep: 0 })}`,
  };
}

/** Two people; person 7 follows a source with one story. */
beforeEach(async () => {
  const made = sqliteD1(...APP_MIGRATIONS);
  restore = installCloudflareContext(made.d1, { SESSION_SECRET });
  made.raw
    .prepare(
      'INSERT INTO users (id, google_sub, email, session_epoch) VALUES (7, ?, ?, 0), (8, ?, ?, 0)',
    )
    .run('g7', 'a@b.com', 'g8', 'b@b.com');
  db = databaseFrom(made.d1);
  const repo = new Repository(db);
  const feed = (await repo.addFeed(7, 'https://a.test/f'))!;
  await repo.writeEdition(feed.source_id, '2026-10-20', [
    {
      url: 'https://x/1',
      title: 'One',
      source: 'x',
      favicon: '',
      summary: '',
      image: '',
      published_at: '',
      points: 0,
    },
  ]);
  const articles = await repo.sourceArticles(feed.source_id, '2026-10-20');
  story = articles[0]!.id;
  auth = await cookieFor(7);
});

afterEach(() => restore());

const at = (name: string) =>
  `https://app.test/api/users/self/saves/tags/${encodeURIComponent(name)}`;

const rename = (name: string, body: string, headers = {}) =>
  PATCH(
    new Request(at(name), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth, ...headers },
      body,
    }),
    { params: Promise.resolve({ name }) },
  );

const remove = (name: string) =>
  DELETE(new Request(at(name), { method: 'DELETE', headers: { ...auth } }), {
    params: Promise.resolve({ name }),
  });

const tags = async () => {
  const save = await new Repository(db).getSave(7, story);
  return save?.tags ?? [];
};

beforeEach(async () => {
  await new Repository(db).saveArticle(7, story, ['old news', 'b']);
});

describe('PATCH /api/users/self/saves/tags/:name', () => {
  it('answers 200 with the renamed tag and its count', async () => {
    const res = await rename('old news', '{"name":"fresh"}');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: 'fresh', count: 1 });
  });

  it('renames the tag on the saves', async () => {
    await rename('old news', '{"name":"fresh"}');
    expect(await tags()).toEqual(['fresh', 'b']);
  });

  it('answers 400 as a problem for a bad name', async () => {
    const res = await rename('b', '{"name":""}');
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });

  it('answers 415 for a body that is not JSON', async () => {
    const res = await rename('b', 'x', { 'Content-Type': 'text/plain' });
    expect(res.status).toBe(415);
  });

  it('answers 404 for a tag no save carries', async () => {
    const res = await rename('zzz', '{"name":"a"}');
    expect(res.status).toBe(404);
  });

  it('answers 404, renaming nothing, for another person', async () => {
    auth = await cookieFor(8);
    const res = await rename('b', '{"name":"c"}');
    expect(res.status).toBe(404);
    expect(await tags()).toEqual(['old news', 'b']);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    const res = await rename('b', '{"name":"c"}');
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/users/self/saves/tags/:name', () => {
  it('answers 204 and takes the tag off, keeping the save', async () => {
    const res = await remove('b');
    expect(res.status).toBe(204);
    expect(await tags()).toEqual(['old news']);
  });

  it('answers 404 as a problem the second time', async () => {
    await remove('b');
    const res = await remove('b');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    const res = await remove('b');
    expect(res.status).toBe(401);
  });

  it('answers 404 for a name that is not valid percent-encoding', async () => {
    const res = await DELETE(
      new Request('https://app.test/api/users/self/saves/tags/%E0%A4%A', {
        method: 'DELETE',
        headers: { ...auth },
      }),
      { params: Promise.resolve({ name: '%E0%A4%A' }) },
    );
    expect(res.status).toBe(404);
  });
});
