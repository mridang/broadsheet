import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import { createDatabase, type Database } from '@/domain/db/client';
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

/** What the next refresh does: the source it is for, and how it went. */
let works = true;
const refreshSource = jest.fn(
  async (db: unknown, _env: unknown, source: { id: number }) => {
    const repo = new Repository(db as Database);
    await repo.recordFetch(source.id, works ? undefined : 'HTTP 404');
    return { ok: works, n: 0 };
  },
);
jest.unstable_mockModule('@/domain/scraping/index', () => ({
  refreshSource,
  discoverFeed: async (url: string) => url,
}));

const { POST } = await import('@/app/api/feeds/[id]/refreshes/route');

let restore: () => void;
let repo: Repository;
let mine: number;
let sourceId: number;
let auth: Record<string, string>;

beforeEach(async () => {
  works = true;
  refreshSource.mockClear();
  const made = sqliteD1(...APP_MIGRATIONS);
  restore = installCloudflareContext(made.d1, { SESSION_SECRET });
  made.raw
    .prepare(
      'INSERT INTO users (id, google_sub, email, session_epoch) VALUES (7, ?, ?, 0), (8, ?, ?, 0)',
    )
    .run('g7', 'a@b.com', 'g8', 'b@b.com');
  repo = new Repository(createDatabase(made.d1));
  const feed = (await repo.addFeed(7, 'https://a.test/feed.xml'))!;
  mine = feed.id;
  sourceId = feed.source_id;
  for (let n = 0; n < 4; n += 1) await repo.recordFetch(sourceId, 'timeout');
  auth = {
    cookie: `${SESSION_COOKIE}=${await tokenFor({ id: 7 }, { ep: 0 })}`,
  };
});

afterEach(() => restore());

const retry = (id: string | number, headers: Record<string, string> = auth) =>
  POST(
    new Request(`https://app.test/api/feeds/${id}/refreshes`, {
      method: 'POST',
      headers,
    }),
  );

describe('POST /api/feeds/:id/refreshes', () => {
  it('forgets the failures, fetches, and answers 200 with the statistics', async () => {
    const res = await retry(mine);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ fail_count: 0 });
    expect(refreshSource).toHaveBeenCalledTimes(1);
  });

  it('answers 502 as a problem when it fails again, with the reason', async () => {
    works = false;
    const res = await retry(mine);
    expect(res.status).toBe(502);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    expect(((await res.json()) as { detail: string }).detail).toContain(
      'HTTP 404',
    );
    const stats = await repo.feedStatistics(7, mine);
    expect(stats?.fail_count).toBe(1);
  });

  it('answers 404, fetching nothing, for another person’s feed, a missing one or a bad id', async () => {
    const other = {
      cookie: `${SESSION_COOKIE}=${await tokenFor({ id: 8 }, { ep: 0 })}`,
    };
    for (const [id, headers] of [
      [mine, other],
      [999, auth],
      ['imports', auth],
    ] as const) {
      const res = await retry(id, headers);
      expect(res.status).toBe(404);
    }
    expect(refreshSource).not.toHaveBeenCalled();
    const stats = await repo.feedStatistics(7, mine);
    expect(stats?.fail_count).toBe(4);
  });

  it('answers 401 when nobody is signed in', async () => {
    const res = await retry(mine, {});
    expect(res.status).toBe(401);
  });
});
