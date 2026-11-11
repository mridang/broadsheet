import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { databaseFrom, type Database } from '@/domain/db/database';
import { Repository } from '@/domain/repository';
import { SESSION_COOKIE } from '@/domain/auth/app';
import { APP_MIGRATIONS } from '../../../../../../lib/core/db/migrations';
import {
  installCloudflareContext,
  sqliteD1,
} from '../../../../../../lib/core/db/sqlite-d1';
import {
  SESSION_SECRET,
  tokenFor,
} from '../../../../../../domain/auth/auth-test-kit';

const { POST, DELETE } =
  await import('@/app/api/users/self/saves/[article_id]/route');

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
  const articles = await repo.sourceArticles(source_id, '2026-10-20');
  story = articles[0]!.id;
  auth = await cookieFor(7);
});

afterEach(() => restore());

const call = (
  method: 'POST' | 'DELETE',
  id: string | number,
  init: RequestInit = {},
) =>
  (method === 'POST' ? POST : DELETE)(
    new Request(`https://app.test/api/users/self/saves/${id}`, {
      method,
      ...init,
      headers: { ...auth, ...(init.headers as Record<string, string>) },
    }),
    { params: Promise.resolve({ article_id: String(id) }) },
  );

const json = (body: string) => ({
  body,
  headers: { 'Content-Type': 'application/json' },
});

const saves = () => new Repository(db).listSaves(7);

describe('POST /api/users/self/saves/:article_id', () => {
  it('answers 201 with no body, saving the story untagged', async () => {
    const res = await call('POST', story);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ tags: [] });
  });

  it('answers with the save’s Location', async () => {
    const res = await call('POST', story);
    expect(res.headers.get('location')).toMatch(
      new RegExp(`/api/users/self/saves/${story}$`),
    );
  });

  it('answers 200 with the new tags when saved again', async () => {
    await call('POST', story);
    const res = await call('POST', story, json('{"tags":["a"]}'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ tags: ['a'] });
  });

  it('answers 400 as a problem for bad tags', async () => {
    const res = await call('POST', story, json('{"tags":"a"}'));
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });

  it('answers 415 for a body that is not JSON', async () => {
    const res = await call('POST', story, {
      body: 'x',
      headers: { 'Content-Type': 'text/plain' },
    });
    expect(res.status).toBe(415);
  });

  it.each(['999', 'abc'])('answers 404 for article %j', async (id) => {
    const res = await call('POST', id);
    expect(res.status).toBe(404);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    const res = await call('POST', story);
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/users/self/saves/:article_id', () => {
  beforeEach(async () => {
    await new Repository(db).saveArticle(7, story, []);
  });

  it('answers 204 and the save is gone', async () => {
    const res = await call('DELETE', story);
    expect(res.status).toBe(204);
    expect(await saves()).toEqual([]);
  });

  it('answers 404 as a problem the second time', async () => {
    await call('DELETE', story);
    const res = await call('DELETE', story);
    expect(res.status).toBe(404);
  });

  it('answers 404, removing nothing, for another person', async () => {
    auth = await cookieFor(8);
    const res = await call('DELETE', story);
    expect(res.status).toBe(404);
    expect(await saves()).toHaveLength(1);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    const res = await call('DELETE', story);
    expect(res.status).toBe(401);
  });
});
