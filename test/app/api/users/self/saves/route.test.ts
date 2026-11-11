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

const { GET } = await import('@/app/api/users/self/saves/route');

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

const list = (query = '') =>
  GET(
    new Request(`https://app.test/api/users/self/saves${query}`, {
      headers: { ...auth },
    }),
    { params: Promise.resolve({}) },
  );

const items = async (query = '') => {
  const res = await list(query);
  return ((await res.json()) as { items: unknown[] }).items;
};

describe('GET /api/users/self/saves', () => {
  beforeEach(async () => {
    await new Repository(db).saveArticle(7, story, ['keep']);
  });

  it('answers 200 with the saved stories as a page', async () => {
    expect(await items()).toMatchObject([
      { article_id: String(story), tags: ['keep'] },
    ]);
  });

  it('lists only the stories with the tag asked for', async () => {
    expect(await items('?tag=other')).toEqual([]);
  });

  it('lists only the stories matching q', async () => {
    expect(await items('?q=one')).toHaveLength(1);
    expect(await items('?q=tag%3Akeep')).toHaveLength(1);
    expect(await items('?q=author%3Anobody')).toEqual([]);
  });

  it('answers 400 for too long a q', async () => {
    const res = await list(`?q=${'a'.repeat(201)}`);
    expect(res.status).toBe(400);
  });

  it('shows nobody else’s saves', async () => {
    auth = await cookieFor(8);
    expect(await items()).toEqual([]);
  });

  it('answers 400 for a bad limit', async () => {
    const res = await list('?limit=0');
    expect(res.status).toBe(400);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    const res = await list();
    expect(res.status).toBe(401);
  });
});

describe('GET /api/users/self/saves?feed_id', () => {
  beforeEach(async () => {
    await new Repository(db).saveArticle(7, story, []);
  });

  it('lists the saves from that feed', async () => {
    const [feed] = await new Repository(db).listFeeds(7);
    expect(await items(`?feed_id=${feed!.id}`)).toHaveLength(1);
  });

  it.each(['abc', '999'])(
    'answers 400 for feed %j, which the person does not follow',
    async (id) => {
      const res = await list(`?feed_id=${id}`);
      expect(res.status).toBe(400);
      expect(res.headers.get('content-type')).toBe('application/problem+json');
    },
  );

  it('lists every save for an empty tag', async () => {
    expect(await items('?tag=')).toHaveLength(1);
  });
});
