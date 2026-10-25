import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import { databaseFrom, type Database } from '@/domain/db/database';
import type { Feed } from '@/domain/repository';
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

const addFeed = (d: Database, u: number, url: string, t?: string) =>
  new Repository(d).addFeed(u, url, t);

/** What each refresh does, by feed address. */
const outcome = new Map<string, 'ok' | 'empty' | 'throws'>();
const refreshFeed = jest.fn(async (_db: unknown, _env: unknown, feed: Feed) => {
  const how = outcome.get(feed.url) ?? 'ok';
  if (how === 'throws') {
    throw new Error('boom');
  }
  return { ok: how === 'ok', n: 0 };
});
jest.unstable_mockModule('@/domain/scraping/index', () => ({
  refreshFeed,
}));

const { POST } = await import('@/app/api/feeds/refreshes/route');

let restore: () => void;
/** The Cookie header the browser sends; empty for a signed-out caller. */
let auth: Record<string, string>;

/** A Cookie header carrying a signed session for `uid`. */
async function cookieFor(uid: number): Promise<Record<string, string>> {
  return {
    cookie: `${SESSION_COOKIE}=${await tokenFor({ id: uid }, { ep: 0 })}`,
  };
}

beforeEach(async () => {
  outcome.clear();
  refreshFeed.mockClear();
  const made = sqliteD1(...APP_MIGRATIONS);
  restore = installCloudflareContext(made.d1, { SESSION_SECRET });
  made.raw
    .prepare(
      'INSERT INTO users (id, google_sub, email, session_epoch) VALUES (7, ?, ?, 0), (8, ?, ?, 0)',
    )
    .run('g7', 'a@b.com', 'g8', 'b@b.com');
  const db = databaseFrom(made.d1);
  await addFeed(db, 7, 'https://a.test/1');
  await addFeed(db, 7, 'https://a.test/2');
  await addFeed(db, 8, 'https://a.test/other');
  auth = await cookieFor(7);
});

afterEach(() => restore());

const refresh = () =>
  POST(
    new Request('https://app.test/api/feeds/refreshes', {
      method: 'POST',
      headers: { ...auth },
    }),
  );

describe('POST /api/feeds/refreshes', () => {
  it('refreshes only the caller’s feeds and says how it went', async () => {
    const res = await refresh();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ feeds: 2, refreshed: 2, failed: 0 });
    expect(refreshFeed.mock.calls.map((c) => c[2].url).toSorted()).toEqual([
      'https://a.test/1',
      'https://a.test/2',
    ]);
  });

  it('counts a feed that gave nothing or threw as failed, without failing the rest', async () => {
    outcome.set('https://a.test/1', 'throws');
    outcome.set('https://a.test/2', 'empty');
    const res = await refresh();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ feeds: 2, refreshed: 0, failed: 2 });
  });

  it('answers 401 as a problem when nobody is signed in, refreshing nothing', async () => {
    auth = {};
    const res = await refresh();
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    expect(refreshFeed).not.toHaveBeenCalled();
  });
});
