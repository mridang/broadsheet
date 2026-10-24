import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import { createDatabase, type Database } from '@/core/db/client';
import { Repository } from '@/domain/repository';
const addFeed = (d: Database, u: number, url: string, t?: string) =>
  new Repository(d).addFeed(u, url, t);
const listFeeds = (d: Database, u: number) => new Repository(d).listFeeds(u);
import { APP_MIGRATIONS } from '../../../../core/db/migrations';
import {
  installCloudflareContext,
  sqliteD1,
} from '../../../../core/db/sqlite-d1';

/** Who is signed in; null means nobody. */
const session: { id: number | null } = { id: 7 };

const { problems } = await import('@/lib/rest-json/problem');
jest.unstable_mockModule('@/core/auth/guard', () => ({
  requireUser: async (request: Request) => {
    if (session.id === null) {
      throw problems.unauthorized();
    }
    return { request, user: { id: session.id } };
  },
}));

const { DELETE } = await import('@/app/api/feeds/[id]/route');

let restore: () => void;
let db: Database;
let mine: number;

beforeEach(async () => {
  session.id = 7;
  const made = sqliteD1(...APP_MIGRATIONS);
  restore = installCloudflareContext(made.d1);
  db = createDatabase(made.d1);
  mine = (await addFeed(db, 7, 'https://a.test/feed.xml'))!.id;
});

afterEach(() => restore());

const remove = (id: string | number) =>
  DELETE(
    new Request(`https://app.test/api/feeds/${id}`, { method: 'DELETE' }),
    {
      params: Promise.resolve({ id: String(id) }),
    },
  );

describe('DELETE /api/feeds/:id', () => {
  it('answers 204 and the feed is gone', async () => {
    const res = await remove(mine);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(await listFeeds(db, 7)).toHaveLength(0);
  });

  it('answers 404 as a problem the second time', async () => {
    await remove(mine);
    const res = await remove(mine);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });

  it('answers 404, removing nothing, for another person’s feed', async () => {
    session.id = 8;
    expect((await remove(mine)).status).toBe(404);
    expect(await listFeeds(db, 7)).toHaveLength(1);
  });

  it.each(['refreshes', 'abc', '1; DROP TABLE feeds', '0', '-1'])(
    'answers 404 for %j, which cannot name a feed',
    async (id) => {
      expect((await remove(id)).status).toBe(404);
      expect(await listFeeds(db, 7)).toHaveLength(1);
    },
  );

  it('answers 401 when nobody is signed in, removing nothing', async () => {
    session.id = null;
    expect((await remove(mine)).status).toBe(401);
    expect(await listFeeds(db, 7)).toHaveLength(1);
  });
});
