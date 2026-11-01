import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import { SESSION_COOKIE } from '@/domain/auth/app';
import { Repository } from '@/domain/repository';
import { databaseFrom } from '@/domain/db/database';
import { APP_MIGRATIONS } from '../../../../../lib/core/db/migrations';
import {
  installCloudflareContext,
  sqliteD1,
} from '../../../../../lib/core/db/sqlite-d1';
import {
  SESSION_SECRET,
  tokenFor,
} from '../../../../../domain/auth/auth-test-kit';

const refreshSource = jest.fn<(...args: unknown[]) => Promise<unknown>>(
  async () => ({ ok: true, n: 0 }),
);
jest.unstable_mockModule('@/domain/scraping/index', () => ({
  refreshSource,
  discoverFeed: async (url: string) => url,
}));

const route = await import('@/app/api/feeds/[id]/statistics/route');

let restore: () => void;
let repo: Repository;
let auth: Record<string, string>;
const origin = 'https://app.test';

beforeEach(async () => {
  refreshSource.mockClear();
  const made = sqliteD1(...APP_MIGRATIONS);
  restore = installCloudflareContext(made.d1, { SESSION_SECRET });
  made.raw
    .prepare(
      'INSERT INTO users (id, google_sub, email, session_epoch) VALUES (7, ?, ?, 0), (8, ?, ?, 0)',
    )
    .run('g7', 'a@b.com', 'g8', 'b@b.com');
  repo = new Repository(databaseFrom(made.d1));
  auth = {
    cookie: `${SESSION_COOKIE}=${await tokenFor({ id: 7 }, { ep: 0 })}`,
  };
});

afterEach(() => restore());

const get = (id: string, headers: Record<string, string> = auth) =>
  route.GET(new Request(`${origin}/api/feeds/${id}/statistics`, { headers }));

describe('GET /api/feeds/:id/statistics', () => {
  it('reports the last fetch, error, failures and stories per day', async () => {
    const feed = (await repo.addFeed(7, 'https://a.test/f'))!;
    await repo.recordFetch(feed.source_id);
    await repo.recordFetch(feed.source_id, 'timeout');
    const res = await get(String(feed.id));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      last_fetched_at: expect.stringMatching(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
      ),
      last_error: 'timeout',
      fail_count: 1,
      stories_per_day: [],
    });
  });

  it('omits what is unknown', async () => {
    const feed = (await repo.addFeed(7, 'https://a.test/f'))!;
    expect(await (await get(String(feed.id))).json()).toEqual({
      fail_count: 0,
      subscribers: 1,
      active_subscribers: 1,
      story_count: 0,
      stories_last_month: 0,
      average_stories_per_month: 0,
      stories_per_day: [],
      stories_per_month: [],
      stories_per_weekday: {},
      stories_per_hour: {},
      fetch_history: [],
    });
  });

  it('answers 404 for another person’s feed, a missing one, or a bad id', async () => {
    const feed = (await repo.addFeed(8, 'https://a.test/f'))!;
    for (const id of [String(feed.id), '999', 'imports', '0']) {
      const res = await get(id);
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toBe('application/problem+json');
    }
  });

  it('answers 401 when nobody is signed in', async () => {
    expect((await get('1', {})).status).toBe(401);
  });
});
