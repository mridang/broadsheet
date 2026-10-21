import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import { createDatabase } from '../../../../src/lib/db/client';
import type { Feed } from '../../../../src/lib/repository';
import { addFeed } from '../../../../src/lib/repository';
import { APP_MIGRATIONS } from '../../../lib/db/migrations';
import { installCloudflareContext, sqliteD1 } from '../../../lib/db/sqlite-d1';

/** Who is signed in; null means nobody. */
const session: { id: number | null } = { id: 7 };

const { problems } = await import('../../../../src/lib/api/problem');
jest.unstable_mockModule('../../../../src/lib/auth/guard', () => ({
  requireSignedIn: async () =>
    session.id === null
      ? { ok: false, response: problems.unauthorized() }
      : { ok: true, user: { id: session.id } },
}));

/** What each refresh does, by feed address. */
const outcome = new Map<string, 'ok' | 'empty' | 'throws'>();
const refreshFeed = jest.fn(async (_db: unknown, _env: unknown, feed: Feed) => {
  const how = outcome.get(feed.url) ?? 'ok';
  if (how === 'throws') {
    throw new Error('boom');
  }
  return { ok: how === 'ok', n: 0 };
});
jest.unstable_mockModule('../../../../src/lib/scraping', () => ({
  refreshFeed,
}));

const { POST } = await import('../../../../src/app/api/feed-refreshes/route');

let restore: () => void;

beforeEach(async () => {
  session.id = 7;
  outcome.clear();
  refreshFeed.mockClear();
  const made = sqliteD1(...APP_MIGRATIONS);
  restore = installCloudflareContext(made.d1);
  const db = createDatabase(made.d1);
  await addFeed(db, 7, 'https://a.test/1');
  await addFeed(db, 7, 'https://a.test/2');
  await addFeed(db, 8, 'https://a.test/other');
});

afterEach(() => restore());

const refresh = () =>
  POST(new Request('https://app.test/api/feed-refreshes', { method: 'POST' }));

describe('POST /api/feed-refreshes', () => {
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
    session.id = null;
    const res = await refresh();
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    expect(refreshFeed).not.toHaveBeenCalled();
  });
});
