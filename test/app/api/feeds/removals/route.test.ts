import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { databaseFrom, type Database } from '@/domain/db/database';
import { Repository } from '@/domain/repository';
import { SESSION_COOKIE } from '@/domain/auth/app';
import { APP_MIGRATIONS } from '../../../../lib/core/db/migrations';
import {
  installCloudflareContext,
  sqliteD1,
} from '../../../../lib/core/db/sqlite-d1';
import {
  SESSION_SECRET,
  tokenFor,
} from '../../../../domain/auth/auth-test-kit';

const { POST } = await import('@/app/api/feeds/removals/route');

let restore: () => void;
let db: Database;
let repo: Repository;
let mine: number;
let theirs: number;
let auth: Record<string, string>;

async function cookieFor(uid: number): Promise<Record<string, string>> {
  return {
    cookie: `${SESSION_COOKIE}=${await tokenFor({ id: uid }, { ep: 0 })}`,
  };
}

beforeEach(async () => {
  const made = sqliteD1(...APP_MIGRATIONS);
  restore = installCloudflareContext(made.d1, { SESSION_SECRET });
  made.raw
    .prepare(
      'INSERT INTO users (id, google_sub, email, session_epoch) VALUES (7, ?, ?, 0), (8, ?, ?, 0)',
    )
    .run('g7', 'a@b.com', 'g8', 'b@b.com');
  db = databaseFrom(made.d1);
  repo = new Repository(db);
  mine = (await repo.addFeed(7, 'https://a.test/f'))!.id;
  theirs = (await repo.addFeed(8, 'https://b.test/f'))!.id;
  auth = await cookieFor(7);
});

afterEach(() => restore());

const post = (body: string, headers = {}) =>
  POST(
    new Request('https://app.test/api/feeds/removals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth, ...headers },
      body,
    }),
  );

const errors = async (res: Response) =>
  ((await res.json()) as { errors: string[] }).errors;

describe('POST /api/feeds/removals', () => {
  it('unfollows the caller’s feeds, skipping others’, and counts them', async () => {
    const res = await post(
      JSON.stringify({ feed_ids: [String(mine), String(theirs)] }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: 1 });
    expect(await repo.listFeeds(7)).toEqual([]);
    expect(await repo.listFeeds(8)).toHaveLength(1);
  });

  it.each([
    [{}, 'feed_ids: a list of 1 to 500 feed ids.'],
    [{ feed_ids: ['0'] }, 'feed_ids: a list of 1 to 500 feed ids.'],
    [
      { feed_ids: Array.from({ length: 501 }, (_, i) => String(i + 1)) },
      'feed_ids: a list of 1 to 500 feed ids.',
    ],
    [{ feed_ids: ['1'], all: true }, 'all: not a member of a removal.'],
  ])('answers 400 as a problem for %j', async (body, error) => {
    const res = await post(JSON.stringify(body));
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    expect(await errors(res)).toEqual([error]);
  });

  it('answers 415 for a body that is not JSON', async () => {
    expect((await post('x', { 'Content-Type': 'text/plain' })).status).toBe(
      415,
    );
  });

  it('answers 401 when nobody is signed in, removing nothing', async () => {
    auth = {};
    expect(
      (await post(JSON.stringify({ feed_ids: [String(mine)] }))).status,
    ).toBe(401);
    expect(await repo.listFeeds(7)).toHaveLength(1);
  });
});
