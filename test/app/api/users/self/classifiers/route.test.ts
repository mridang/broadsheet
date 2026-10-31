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

const { GET, POST } = await import('@/app/api/users/self/classifiers/route');

let restore: () => void;
let db: Database;
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
  const { source_id } = (await repo.addFeed(7, 'https://a.test/f'))!;
  await repo.writeEdition(source_id, '2026-10-20', [
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
  auth = await cookieFor(7);
});

afterEach(() => restore());

const post = (body: string, headers = {}) =>
  POST(
    new Request('https://app.test/api/users/self/classifiers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth, ...headers },
      body,
    }),
    { params: Promise.resolve({}) },
  );

const list = (query = '') =>
  GET(
    new Request(`https://app.test/api/users/self/classifiers${query}`, {
      headers: { ...auth },
    }),
    { params: Promise.resolve({}) },
  );

const liked = JSON.stringify({ kind: 'source', value: 'x', score: 'like' });

describe('POST /api/users/self/classifiers', () => {
  it('answers 201 with the classifier', async () => {
    const res = await post(liked);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ kind: 'source', score: 'like' });
  });

  it('answers with the new classifier’s Location', async () => {
    const res = await post(liked);
    const { id } = (await res.json()) as { id: string };
    expect(res.headers.get('location')).toMatch(
      new RegExp(`/api/users/self/classifiers/${id}$`),
    );
  });

  it('answers 200 with the new score for a kind and value trained before', async () => {
    await post(liked);
    const res = await post(liked.replace('like', 'dislike'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ score: 'dislike' });
  });

  it('answers 400 as a problem naming the bad field', async () => {
    const res = await post(
      JSON.stringify({ kind: 'x', value: 'y', score: 'like' }),
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });

  it('answers 415 for a body that is not JSON', async () => {
    expect((await post('x', { 'Content-Type': 'text/plain' })).status).toBe(
      415,
    );
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    expect((await post(liked)).status).toBe(401);
  });
});

describe('GET /api/users/self/classifiers', () => {
  it('answers 200 with the person’s classifiers as a page', async () => {
    await post(liked);
    const body = (await (await list()).json()) as { items: unknown[] };
    expect(body.items).toHaveLength(1);
  });

  it('hands out a next link when more follow', async () => {
    await post(liked);
    await post(JSON.stringify({ kind: 'title', value: 'y', score: 'like' }));
    const body = (await (await list('?limit=1')).json()) as { next?: string };
    expect(body.next).toContain('cursor=');
  });

  it('shows nobody else’s classifiers', async () => {
    await post(liked);
    auth = await cookieFor(8);
    expect(
      ((await (await list()).json()) as { items: unknown[] }).items,
    ).toEqual([]);
  });

  it('answers 400 for a cursor it did not issue', async () => {
    expect((await list('?cursor=nope')).status).toBe(400);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    expect((await list()).status).toBe(401);
  });
});
