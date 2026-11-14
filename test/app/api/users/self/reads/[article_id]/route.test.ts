import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { createDatabase, type Database } from '@/domain/db/client';
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

const { POST, PATCH, DELETE } =
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
  db = createDatabase(made.d1);
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
    const read7 = await repo.readState(7);
    expect([...read7.ids]).toEqual([story]);
    const read8 = await repo.readState(8);
    expect(read8.ids.size).toBe(0);
  });

  it('answers 200 the second time', async () => {
    await read(story);
    const res = await read(story);
    expect(res.status).toBe(200);
  });

  it.each(['999', 'abc', '0'])('answers 404 for article %j', async (id) => {
    const res = await read(id);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    const res = await read(story);
    expect(res.status).toBe(401);
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
    const res = await unread(story);
    expect(res.status).toBe(204);
    const left = await new Repository(db).readState(7);
    expect(left.ids.size).toBe(0);
  });

  it.each(['999', 'abc'])('answers 404 for article %j', async (id) => {
    const res = await unread(id);
    expect(res.status).toBe(404);
  });

  it('answers 404 for a story that was not read', async () => {
    const res = await unread(story);
    expect(res.status).toBe(404);
  });

  it('answers 404 as a problem, unmarking nothing, for another person', async () => {
    await read(story);
    auth = await cookieFor(8);
    const res = await unread(story);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    const after = await new Repository(db).readState(7);
    expect(after.ids.size).toBe(1);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    const res = await unread(story);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/users/self/reads/:article_id with copies', () => {
  let copy: number;

  beforeEach(async () => {
    const repo = new Repository(db);
    const { source_id } = (await repo.addFeed(7, 'https://b.test/f'))!;
    await repo.writeEdition(source_id, '2026-10-20', [
      {
        url: 'https://y/1',
        title: 'One',
        source: 'y',
        favicon: '',
        summary: '',
        image: '',
        published_at: '',
        points: 0,
      },
    ]);
    const articles = await repo.sourceArticles(source_id, '2026-10-20');
    copy = articles[0]!.id;
    await repo.writeClusters('2026-10-20', [[story, copy]]);
  });

  it('leaves the other copies unread by default', async () => {
    await read(story);
    const after = await new Repository(db).readState(7);
    expect([...after.ids]).toEqual([story]);
  });

  it('marks the other copies read when the person asked for that', async () => {
    const repo = new Repository(db);
    await repo.updatePreferences(7, { cluster_mark_read: true });
    await read(story);
    const marked = await repo.readState(7);
    expect([...marked.ids].toSorted((a, b) => a - b)).toEqual(
      [story, copy].toSorted((a, b) => a - b),
    );
  });
});

const time = (id: string | number, body: string) =>
  PATCH(
    new Request(`https://app.test/api/users/self/reads/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth },
      body,
    }),
    { params: Promise.resolve({ article_id: String(id) }) },
  );

describe('PATCH /api/users/self/reads/:article_id', () => {
  it('answers 200 with the longest time spent', async () => {
    await read(story);
    const first = await time(story, '{"seconds":40}');
    expect(first.status).toBe(200);
    const res = await time(story, '{"seconds":12}');
    expect(await res.json()).toEqual({
      article_id: String(story),
      seconds: 40,
    });
  });

  it('answers 404 for a story the person has not read', async () => {
    const res = await time(story, '{"seconds":40}');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });

  it('answers 404 for another person’s read', async () => {
    await read(story);
    auth = await cookieFor(8);
    const res = await time(story, '{"seconds":40}');
    expect(res.status).toBe(404);
  });

  it('answers 400 naming a bad time', async () => {
    await read(story);
    const res = await time(story, '{"seconds":-1}');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { errors: string[] }).errors).toEqual([
      'seconds: must be a whole number from 0.',
    ]);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    const res = await time(story, '{"seconds":40}');
    expect(res.status).toBe(401);
  });
});
