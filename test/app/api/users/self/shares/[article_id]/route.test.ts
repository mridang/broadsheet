import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { databaseFrom, type Database } from '@/domain/db/database';
import { Repository } from '@/domain/repository';
import { ShareRepository } from '@/domain/shares';
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
  await import('@/app/api/users/self/shares/[article_id]/route');

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
  story = (await repo.sourceArticles(source_id, '2026-10-20'))[0]!.id;
  auth = await cookieFor(7);
});

afterEach(() => restore());

const call = (
  method: 'POST' | 'DELETE',
  id: string | number,
  init: RequestInit = {},
) =>
  (method === 'POST' ? POST : DELETE)(
    new Request(`https://app.test/api/users/self/shares/${id}`, {
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

const shares = () => new ShareRepository(db).list({ limit: 10 });
describe('POST /api/users/self/shares/:article_id', () => {
  it('answers 201 with no body, sharing the story without a comment', async () => {
    const res = await call('POST', story);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      article_id: String(story),
      sharer: { id: '7' },
    });
  });

  it('answers with the share’s Location', async () => {
    const res = await call('POST', story);
    expect(res.headers.get('location')).toMatch(
      new RegExp(`/api/users/self/shares/${story}$`),
    );
  });

  it('answers 200 with the new comment when shared again', async () => {
    await call('POST', story);
    const res = await call('POST', story, json('{"comments":" Worth it "}'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ comments: 'Worth it' });
  });

  it('never shows the sharer’s email', async () => {
    const res = await call('POST', story);
    expect(JSON.stringify(await res.json())).not.toContain('a@b.com');
  });

  it('answers 400 as a problem for a bad comment', async () => {
    const res = await call('POST', story, json('{"comments":1}'));
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
    expect((await call('POST', id)).status).toBe(404);
  });

  it('answers 404 for a story outside the person’s feeds', async () => {
    auth = await cookieFor(8);
    expect((await call('POST', story)).status).toBe(404);
    expect(await shares()).toEqual([]);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    expect((await call('POST', story)).status).toBe(401);
  });
});

describe('DELETE /api/users/self/shares/:article_id', () => {
  beforeEach(async () => {
    await new ShareRepository(db).share(7, story, null);
  });

  it('answers 204 and the share is gone', async () => {
    expect((await call('DELETE', story)).status).toBe(204);
    expect(await shares()).toEqual([]);
  });

  it('answers 404 as a problem the second time', async () => {
    await call('DELETE', story);
    expect((await call('DELETE', story)).status).toBe(404);
  });

  it('answers 404, removing nothing, for another person', async () => {
    auth = await cookieFor(8);
    expect((await call('DELETE', story)).status).toBe(404);
    expect(await shares()).toHaveLength(1);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    expect((await call('DELETE', story)).status).toBe(401);
  });
});
