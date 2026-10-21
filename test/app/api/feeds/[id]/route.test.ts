import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import { createDatabase } from '../../../../../src/lib/db/client';
import { addFeed } from '../../../../../src/lib/repository';
import { APP_MIGRATIONS } from '../../../../lib/db/migrations';
import {
  installCloudflareContext,
  sqliteD1,
} from '../../../../lib/db/sqlite-d1';

/** Who is signed in; null means nobody. */
const session: { id: number | null } = { id: 7 };

const { problems } = await import('../../../../../src/lib/api/problem');
jest.unstable_mockModule('../../../../../src/lib/auth/guard', () => ({
  requireSignedIn: async () =>
    session.id === null
      ? { ok: false, response: problems.unauthorized() }
      : { ok: true, user: { id: session.id } },
}));

const { DELETE, GET } =
  await import('../../../../../src/app/api/feeds/[id]/route');

let restore: () => void;
let mine: number;

beforeEach(async () => {
  session.id = 7;
  const made = sqliteD1(...APP_MIGRATIONS);
  restore = installCloudflareContext(made.d1);
  const db = createDatabase(made.d1);
  mine = (await addFeed(db, 7, 'https://a.test/feed.xml'))!.id;
});

afterEach(() => restore());

const at = (id: string | number, method: string) => ({
  request: new Request(`https://app.test/api/feeds/${id}`, { method }),
  ctx: { params: Promise.resolve({ id: String(id) }) },
});
const get = (id: string | number) => {
  const { request, ctx } = at(id, 'GET');
  return GET(request, ctx);
};
const remove = (id: string | number) => {
  const { request, ctx } = at(id, 'DELETE');
  return DELETE(request, ctx);
};

describe('GET /api/feeds/:id', () => {
  it('answers 200 with the feed, not to be cached by anyone else', async () => {
    const res = await get(mine);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: String(mine),
      url: 'https://a.test/feed.xml',
    });
    expect(res.headers.get('cache-control')).toBe('private, no-cache');
  });

  it('answers 404 for a feed that is not there, or is another person’s', async () => {
    expect((await get(mine + 1)).status).toBe(404);
    session.id = 8;
    const res = await get(mine);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });

  it('answers 404 for an id that cannot name a feed', async () => {
    expect((await get('abc')).status).toBe(404);
  });

  it('answers 401 when nobody is signed in', async () => {
    session.id = null;
    expect((await get(mine)).status).toBe(401);
  });
});

describe('DELETE /api/feeds/:id', () => {
  it('answers 204 and the feed is gone', async () => {
    const res = await remove(mine);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect((await get(mine)).status).toBe(404);
  });

  it('answers 404 the second time', async () => {
    await remove(mine);
    expect((await remove(mine)).status).toBe(404);
  });

  it('answers 404, removing nothing, for another person’s feed', async () => {
    session.id = 8;
    expect((await remove(mine)).status).toBe(404);
    session.id = 7;
    expect((await get(mine)).status).toBe(200);
  });

  it('answers 404 for an id that cannot name a feed', async () => {
    expect((await remove('1; DROP TABLE feeds')).status).toBe(404);
    expect((await get(mine)).status).toBe(200);
  });

  it('answers 401 when nobody is signed in, removing nothing', async () => {
    session.id = null;
    expect((await remove(mine)).status).toBe(401);
    session.id = 7;
    expect((await get(mine)).status).toBe(200);
  });
});
