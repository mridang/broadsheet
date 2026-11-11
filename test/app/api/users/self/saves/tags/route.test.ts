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

const { GET } = await import('@/app/api/users/self/saves/tags/route');

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

const list = () =>
  GET(
    new Request('https://app.test/api/users/self/saves/tags', {
      headers: { ...auth },
    }),
    { params: Promise.resolve({}) },
  );

describe('GET /api/users/self/saves/tags', () => {
  it('answers 200 with each tag and its count', async () => {
    await new Repository(db).saveArticle(7, story, ['a', 'b']);
    const res = await list();
    expect(await res.json()).toEqual({
      items: [
        { name: 'a', count: 1 },
        { name: 'b', count: 1 },
      ],
    });
  });

  it('shows nobody else’s tags', async () => {
    await new Repository(db).saveArticle(7, story, ['a']);
    auth = await cookieFor(8);
    const res = await list();
    expect(await res.json()).toEqual({ items: [] });
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    const res = await list();
    expect(res.status).toBe(401);
  });
});
