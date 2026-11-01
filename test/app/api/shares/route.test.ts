import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { databaseFrom, type Database } from '@/domain/db/database';
import { Repository } from '@/domain/repository';
import { ShareRepository } from '@/domain/shares';
import { SESSION_COOKIE } from '@/domain/auth/app';
import { APP_MIGRATIONS } from '../../../lib/core/db/migrations';
import {
  installCloudflareContext,
  sqliteD1,
} from '../../../lib/core/db/sqlite-d1';
import { SESSION_SECRET, tokenFor } from '../../../domain/auth/auth-test-kit';

const { GET } = await import('@/app/api/shares/route');

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

const list = (query = '') =>
  GET(new Request(`https://app.test/api/shares${query}`, { headers: auth }), {
    params: Promise.resolve({}),
  });

describe('GET /api/shares', () => {
  beforeEach(async () => {
    await new ShareRepository(db).share(7, story, 'Good');
  });

  it('lists everyone’s shares to anyone signed in', async () => {
    auth = await cookieFor(8);
    const body = (await (await list()).json()) as { items: unknown[] };
    expect(body.items).toEqual([
      expect.objectContaining({ comments: 'Good', sharer: { id: '7' } }),
    ]);
  });

  it('lists only the people named', async () => {
    const body = (await (await list('?user_id=8')).json()) as {
      items: unknown[];
    };
    expect(body.items).toEqual([]);
  });

  it('pages newest first with a cursor', async () => {
    await new ShareRepository(db).share(8, story, 'Later');
    const first = (await (await list('?limit=1')).json()) as {
      next: string;
      items: { comments: string }[];
    };
    const cursor = new URL(first.next).searchParams.get('cursor');
    const second = (await (await list(`?limit=1&cursor=${cursor}`)).json()) as {
      next?: string;
      items: { comments: string }[];
    };
    expect([first.items[0]!.comments, second.items[0]!.comments]).toEqual([
      'Later',
      'Good',
    ]);
    expect(second.next).toBeUndefined();
  });

  it.each(['?user_id=x', '?limit=0', '?cursor=nope'])(
    'answers 400 as a problem for %s',
    async (query) => {
      const res = await list(query);
      expect(res.status).toBe(400);
      expect(res.headers.get('content-type')).toBe('application/problem+json');
    },
  );

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    expect((await list()).status).toBe(401);
  });
});
