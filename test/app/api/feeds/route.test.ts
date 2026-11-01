import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import type { DatabaseSync } from 'node:sqlite';

import { SESSION_COOKIE } from '@/domain/auth/app';
import { APP_MIGRATIONS } from '../../../lib/core/db/migrations';
import {
  installCloudflareContext,
  settleBackground,
  sqliteD1,
} from '../../../lib/core/db/sqlite-d1';
import { SESSION_SECRET, tokenFor } from '../../../domain/auth/auth-test-kit';

// Identity is resolved from the signed session cookie on the request; the
// resolver has its own tests (test/domain/api/auth). Here we sign a real
// cookie for the caller so the feed endpoints run as that person.
const refreshSource = jest.fn<(...args: unknown[]) => Promise<unknown>>(
  async () => ({ ok: true, n: 0 }),
);
jest.unstable_mockModule('@/domain/scraping/index', () => ({
  refreshSource,
}));

const { GET, POST } = await import('@/app/api/feeds/route');

let raw: DatabaseSync;
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
  refreshSource.mockClear();
  const made = sqliteD1(...APP_MIGRATIONS);
  raw = made.raw;
  restore = installCloudflareContext(made.d1, { SESSION_SECRET });
  raw
    .prepare(
      'INSERT INTO users (id, google_sub, email, session_epoch) VALUES (7, ?, ?, 0), (8, ?, ?, 0)',
    )
    .run('g7', 'a@b.com', 'g8', 'b@b.com');
  auth = await cookieFor(7);
});

afterEach(() => restore());

const URL = 'https://app.test/api/feeds';

/** A POST with the given body text, carrying the current caller's cookie. */
const post = (
  body: string,
  headers: Record<string, string> = { 'content-type': 'application/json' },
) =>
  POST(
    new Request(URL, {
      method: 'POST',
      headers: { ...auth, ...headers },
      body,
    }),
  );

/** The body of a response, as the fields these tests read. */
const body = async (res: Response) =>
  (await res.json()) as { id: string; errors?: string[] };

/** A POST of `{ url }`. */
const follow = (url: string) => post(JSON.stringify({ url }));

/** The feeds stored for a person. */
const stored = (id: number) =>
  raw.prepare('SELECT * FROM subscriptions WHERE user_id = ?').all(id);

describe('POST /api/feeds', () => {
  it('answers 201 with the new feed and where to find it', async () => {
    const res = await follow('https://a.test/feed.xml');
    expect(res.status).toBe(201);
    const feed = await body(res);
    expect(feed).toMatchObject({ url: 'https://a.test/feed.xml' });
    expect(res.headers.get('location')).toBe(
      `https://app.test/api/feeds/${feed.id}`,
    );
    expect(stored(7)).toHaveLength(1);
  });

  it('fetches the first edition of a new feed in the background', async () => {
    await follow('https://a.test/feed.xml');
    await settleBackground();
    expect(refreshSource).toHaveBeenCalledTimes(1);
  });

  it('answers 200 with the same feed when they already follow it, adding nothing', async () => {
    const first = await body(await follow('https://a.test/feed.xml'));
    refreshSource.mockClear();
    const again = await follow('https://a.test/feed.xml');
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(first);
    expect(again.headers.get('location')).toBe(
      `https://app.test/api/feeds/${first.id}`,
    );
    expect(stored(7)).toHaveLength(1);
    expect(refreshSource).not.toHaveBeenCalled();
  });

  it('lets two people follow the same address', async () => {
    await follow('https://a.test/feed.xml');
    auth = await cookieFor(8);
    expect((await follow('https://a.test/feed.xml')).status).toBe(201);
  });

  it('answers 401 as a problem when nobody is signed in, storing nothing', async () => {
    auth = {};
    const res = await follow('https://a.test/feed.xml');
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    expect(stored(7)).toHaveLength(0);
  });

  it('answers 400 naming the field for an address that is not a feed address', async () => {
    const res = await follow('ftp://a.test/f');
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    expect((await body(res)).errors).toEqual([
      'url: must be an http or https address.',
    ]);
  });

  it('answers 400 when the body is not a JSON object', async () => {
    expect((await post('[]')).status).toBe(400);
    expect((await post('{nope')).status).toBe(400);
  });

  it('answers 415 to a form post, the way the old page sent it', async () => {
    const res = await post('url=https%3A%2F%2Fa.test%2Ff', {
      'content-type': 'application/x-www-form-urlencoded',
    });
    expect(res.status).toBe(415);
    expect(stored(7)).toHaveLength(0);
  });
});

const list = (query = '', headers: Record<string, string> = {}) =>
  GET(new Request(`${URL}${query}`, { headers: { ...auth, ...headers } }));

describe('GET /api/feeds', () => {
  it('lists the person’s feeds as a JSON page by default', async () => {
    await follow('https://a.test/1');
    await follow('https://a.test/2');
    const res = await list();
    expect(res.status).toBe(200);
    expect(res.headers.get('vary')).toBe('Accept');
    const page = (await res.json()) as {
      self: string;
      items: { url: string }[];
    };
    expect(page.items.map((f) => f.url)).toEqual([
      'https://a.test/1',
      'https://a.test/2',
    ]);
  });

  it('pages with a cursor and refuses a bad cursor or limit', async () => {
    await follow('https://a.test/1');
    await follow('https://a.test/2');
    const first = (await (await list('?limit=1')).json()) as {
      next: string;
      items: unknown[];
    };
    expect(first.items).toHaveLength(1);
    const second = (await (
      await list(
        `?limit=1&cursor=${new globalThis.URL(first.next).searchParams.get('cursor')}`,
      )
    ).json()) as { items: { url: string }[] };
    expect(second.items.map((f) => f.url)).toEqual(['https://a.test/2']);
    expect((await list('?cursor=!!')).status).toBe(400);
    expect((await list('?limit=0')).status).toBe(400);
  });

  it('answers OPML for Accept: text/x-opml, sections as folders', async () => {
    await follow('https://a.test/1');
    const feedId = (stored(7)[0] as { id: number }).id;
    raw
      .prepare(
        "INSERT INTO sections (id, user_id, name) VALUES (1, 7, 'Tech & Co')",
      )
      .run();
    raw
      .prepare('UPDATE subscriptions SET section_id = 1 WHERE id = ?')
      .run(feedId);
    await follow('https://a.test/2');
    const res = await list('', { accept: 'text/x-opml' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/x-opml; charset=utf-8');
    expect(res.headers.get('vary')).toBe('Accept');
    const xml = await res.text();
    expect(xml).toContain('<outline text="Tech &amp; Co">');
    expect(xml).toContain('xmlUrl="https://a.test/2"');
  });

  it('carries each feed’s stored title and website in the OPML', async () => {
    await follow('https://a.test/1');
    raw
      .prepare(
        "UPDATE sources SET title = 'Real & True', site_url = 'https://a.test/' WHERE url = 'https://a.test/1'",
      )
      .run();
    const xml = await (await list('', { accept: 'text/x-opml' })).text();
    expect(xml).toContain('text="Real &amp; True"');
    expect(xml).toContain('htmlUrl="https://a.test/"');
  });

  it('prefers JSON when the client ranks it first', async () => {
    const res = await list('', { accept: 'application/json, text/x-opml' });
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('answers 401 when nobody is signed in', async () => {
    expect((await GET(new Request(URL))).status).toBe(401);
  });
});
