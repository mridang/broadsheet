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
  await import('@/app/api/users/self/reads/[article_id]/route');

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

const read = (id: string | number) =>
  POST(
    new Request(`https://app.test/api/users/self/reads/${id}`, {
      method: 'POST',
      headers: { ...auth },
    }),
    { params: Promise.resolve({ article_id: String(id) }) },
  );

describe('POST /api/users/self/reads/:article_id', () => {
  it('answers 201 with the read and its Location', async () => {
    const res = await read(story);
    expect(res.status).toBe(201);
    expect(res.headers.get('location')).toMatch(
      new RegExp(`/api/users/self/reads/${story}$`),
    );
  });

  it('notes the story as read for that person only', async () => {
    await read(story);
    const repo = new Repository(db);
    expect([...(await repo.readState(7)).ids]).toEqual([story]);
    expect((await repo.readState(8)).ids.size).toBe(0);
  });

  it('answers 200 the second time', async () => {
    await read(story);
    expect((await read(story)).status).toBe(200);
  });

  it.each(['999', 'abc', '0'])('answers 404 for article %j', async (id) => {
    const res = await read(id);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    expect((await read(story)).status).toBe(401);
  });
});

const unread = (id: string | number) =>
  DELETE(
    new Request(`https://app.test/api/users/self/reads/${id}`, {
      method: 'DELETE',
      headers: { ...auth },
    }),
    { params: Promise.resolve({ article_id: String(id) }) },
  );

describe('DELETE /api/users/self/reads/:article_id', () => {
  it('answers 204 and marks the story unread', async () => {
    await read(story);
    expect((await unread(story)).status).toBe(204);
    expect((await new Repository(db).readState(7)).ids.size).toBe(0);
  });

  it.each(['999', 'abc'])('answers 404 for article %j', async (id) => {
    expect((await unread(id)).status).toBe(404);
  });

  it('answers 404 for a story that was not read', async () => {
    expect((await unread(story)).status).toBe(404);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    expect((await unread(story)).status).toBe(401);
  });
});
