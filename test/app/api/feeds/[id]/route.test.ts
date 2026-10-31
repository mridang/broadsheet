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

const addFeed = (d: Database, u: number, url: string, t?: string) =>
  new Repository(d).addFeed(u, url, t);
const listFeeds = (d: Database, u: number) => new Repository(d).listFeeds(u);

const { PATCH, DELETE } = await import('@/app/api/feeds/[id]/route');

let restore: () => void;
let db: Database;
let mine: number;
/** The Cookie header the browser sends; empty for a signed-out caller. */
let auth: Record<string, string>;

/** A Cookie header carrying a signed session for `uid`. */
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
  mine = (await addFeed(db, 7, 'https://a.test/feed.xml'))!.id;
  auth = await cookieFor(7);
});

afterEach(() => restore());

const remove = (id: string | number) =>
  DELETE(
    new Request(`https://app.test/api/feeds/${id}`, {
      method: 'DELETE',
      headers: { ...auth },
    }),
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
    auth = await cookieFor(8);
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
    auth = {};
    expect((await remove(mine)).status).toBe(401);
    expect(await listFeeds(db, 7)).toHaveLength(1);
  });
});

const patch = (id: string | number, body: string, headers = {}) =>
  PATCH(
    new Request(`https://app.test/api/feeds/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth, ...headers },
      body,
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );

describe('PATCH /api/feeds/:id', () => {
  it('answers 200 with the renamed, muted feed', async () => {
    const res = await patch(
      mine,
      JSON.stringify({ title: 'Mine', muted: true }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: String(mine),
      title: 'Mine',
      muted: true,
    });
  });

  it('files the feed under one of the caller’s sections', async () => {
    const section = await new Repository(db).addSection(7, 'Tech');
    const res = await patch(
      mine,
      JSON.stringify({ section_id: String(section.id) }),
    );
    expect(await res.json()).toMatchObject({ section_id: String(section.id) });
  });

  it('answers 400 naming section_id for another person’s section', async () => {
    const section = await new Repository(db).addSection(8, 'Theirs');
    const res = await patch(
      mine,
      JSON.stringify({ section_id: String(section.id) }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { errors: string[] }).errors).toEqual([
      'section_id: no such section.',
    ]);
  });

  it('answers 400 as a problem naming the bad field', async () => {
    const res = await patch(mine, JSON.stringify({ muted: 'yes' }));
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });

  it('answers 415 for a body that is not JSON', async () => {
    const res = await patch(mine, 'muted=1', { 'Content-Type': 'text/plain' });
    expect(res.status).toBe(415);
  });

  it('answers 404, changing nothing, for another person’s feed', async () => {
    auth = await cookieFor(8);
    expect((await patch(mine, '{"muted":true}')).status).toBe(404);
    expect((await listFeeds(db, 7))[0]?.muted).toBe(false);
  });

  it('answers 404 for an id that cannot name a feed', async () => {
    expect((await patch('abc', '{"muted":true}')).status).toBe(404);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    expect((await patch(mine, '{"muted":true}')).status).toBe(401);
  });
});
