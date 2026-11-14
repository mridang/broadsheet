import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import { databaseFrom, type Database } from '@/domain/db/client';
import { Repository } from '@/domain/repository';
import { SESSION_COOKIE } from '@/domain/auth/app';
import { APP_MIGRATIONS } from '../../../../lib/core/db/migrations';
import {
  installCloudflareContext,
  settleBackground,
  sqliteD1,
} from '../../../../lib/core/db/sqlite-d1';
import {
  SESSION_SECRET,
  tokenFor,
} from '../../../../domain/auth/auth-test-kit';
import insecure from '../../../../fixtures/insecure-urls.json';

const addFeed = (d: Database, u: number, url: string, t?: string) =>
  new Repository(d).addFeed(u, url, t);
const listFeeds = (d: Database, u: number) => new Repository(d).listFeeds(u);

const refreshSource = jest.fn<(...args: unknown[]) => Promise<unknown>>(
  async () => ({ ok: true, n: 0 }),
);
/** What the page at an address declares as its feed; undefined for none. */
let declared: (url: string) => string | undefined = (url) => url;
jest.unstable_mockModule('@/domain/scraping/index', () => ({
  refreshSource,
  discoverFeed: async (url: string) => declared(url),
}));

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
    const res = await remove(mine);
    expect(res.status).toBe(404);
    expect(await listFeeds(db, 7)).toHaveLength(1);
  });

  it.each(['refreshes', 'abc', '1; DROP TABLE feeds', '0', '-1'])(
    'answers 404 for %j, which cannot name a feed',
    async (id) => {
      const res = await remove(id);
      expect(res.status).toBe(404);
      expect(await listFeeds(db, 7)).toHaveLength(1);
    },
  );

  it('answers 401 when nobody is signed in, removing nothing', async () => {
    auth = {};
    const res = await remove(mine);
    expect(res.status).toBe(401);
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

  it('mutes the feed until a time, and says when', async () => {
    const res = await patch(
      mine,
      JSON.stringify({ muted: true, muted_until: '2999-01-01T00:00:00Z' }),
    );
    expect(await res.json()).toMatchObject({
      muted: true,
      muted_until: '2999-01-01T00:00:00Z',
    });
  });

  it('moves the feed in the caller’s order', async () => {
    const res = await patch(mine, JSON.stringify({ position: 3 }));
    expect(await res.json()).toMatchObject({ position: 3 });
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

  it('files the feed in several of the caller’s sections', async () => {
    const repo = new Repository(db);
    const a = await repo.addSection(7, 'A');
    const b = await repo.addSection(7, 'B');
    const res = await patch(
      mine,
      JSON.stringify({ section_ids: [String(b.id), String(a.id)] }),
    );
    expect(await res.json()).toMatchObject({
      section_id: String(b.id),
      section_ids: [String(b.id), String(a.id)],
    });
  });

  it('answers 400 naming section_ids when one is another person’s', async () => {
    const repo = new Repository(db);
    const a = await repo.addSection(7, 'A');
    const theirs = await repo.addSection(8, 'Theirs');
    const res = await patch(
      mine,
      JSON.stringify({ section_ids: [String(a.id), String(theirs.id)] }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { errors: string[] }).errors).toEqual([
      'section_ids: no such section.',
    ]);
  });

  it('gives the feed its own icon and auto mark-read days', async () => {
    const res = await patch(
      mine,
      JSON.stringify({
        custom_icon: { type: 'preset', data: 'rss', color: '#ff5722' },
        auto_mark_read_days: 3,
      }),
    );
    expect(await res.json()).toMatchObject({
      custom_icon: {
        type: 'preset',
        data: 'rss',
        color: '#ff5722',
        set: 'lucide',
      },
      auto_mark_read_days: 3,
    });
  });

  it('answers 404 rather than 400 for another person’s feed with a bad section', async () => {
    auth = await cookieFor(8);
    const res = await patch(mine, JSON.stringify({ section_id: '999' }));
    expect(res.status).toBe(404);
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
    const res = await patch(mine, '{"muted":true}');
    expect(res.status).toBe(404);
    const feeds = await listFeeds(db, 7);
    expect(feeds[0]?.muted).toBe(false);
  });

  it('answers 404 for an id that cannot name a feed', async () => {
    const res = await patch('abc', '{"muted":true}');
    expect(res.status).toBe(404);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    const res = await patch(mine, '{"muted":true}');
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/feeds/:id with a new address', () => {
  beforeEach(() => {
    declared = (url) => url;
  });

  it('follows the feed a page declares', async () => {
    declared = () => 'https://found.test/atom.xml';
    const res = await patch(
      mine,
      JSON.stringify({ url: 'https://found.test/' }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      url: 'https://found.test/atom.xml',
    });
  });

  it('answers 400 when the page declares no feed, changing nothing', async () => {
    declared = () => undefined;
    const res = await patch(
      mine,
      JSON.stringify({ url: 'https://none.test/' }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { errors: string[] }).errors).toEqual([
      'url: no feed was found at this address.',
    ]);
    const feeds = await listFeeds(db, 7);
    expect(feeds[0]?.url).toBe('https://a.test/feed.xml');
  });

  it('follows the new address in its place and fetches it', async () => {
    refreshSource.mockClear();
    const res = await patch(
      mine,
      JSON.stringify({ url: 'https://new.test/f' }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: String(mine),
      url: 'https://new.test/f',
    });
    await settleBackground();
    expect(refreshSource).toHaveBeenCalledTimes(1);
    const feeds = await listFeeds(db, 7);
    expect(feeds.map((f) => f.url)).toEqual(['https://new.test/f']);
  });

  it('answers 409 as a problem when they already follow that address', async () => {
    await addFeed(db, 7, 'https://other.test/f');
    const res = await patch(
      mine,
      JSON.stringify({ url: 'https://other.test/f' }),
    );
    expect(res.status).toBe(409);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    const feeds = await listFeeds(db, 7);
    expect(feeds.map((f) => f.url)).toContain('https://a.test/feed.xml');
  });

  it('changes nothing else, and does not refetch, when the address is the same', async () => {
    refreshSource.mockClear();
    const res = await patch(
      mine,
      JSON.stringify({ url: 'https://a.test/feed.xml', title: 'Kept' }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ title: 'Kept' });
    await settleBackground();
    expect(refreshSource).not.toHaveBeenCalled();
  });

  it('answers 400 for an address that is not http(s)', async () => {
    const res = await patch(mine, JSON.stringify({ url: insecure.ftpFeed }));
    expect(res.status).toBe(400);
  });

  it('answers 404 for another person’s feed', async () => {
    auth = await cookieFor(8);
    const res = await patch(
      mine,
      JSON.stringify({ url: 'https://new.test/f' }),
    );
    expect(res.status).toBe(404);
  });
});
