import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import type { DatabaseSync } from 'node:sqlite';

import type { Feed } from '@/domain/repository';
import { APP_MIGRATIONS } from '../../../core/db/migrations';
import {
  installCloudflareContext,
  settleBackground,
  sqliteD1,
} from '../../../core/db/sqlite-d1';

/** Who is signed in; null means nobody. */
const session: { id: number | null } = { id: 7 };

// The sign-in gate has its own tests (test/lib/auth); here it says who is calling.
const { problems } = await import('@/lib/rest-json/problem');
jest.unstable_mockModule('@/core/auth/guard', () => ({
  requireUser: async (request: Request) => {
    if (session.id === null) {
      throw problems.unauthorized();
    }
    return { request, user: { id: session.id } };
  },
}));

const refreshFeed = jest.fn<(...args: unknown[]) => Promise<unknown>>(
  async () => ({ ok: true, n: 0 }),
);
jest.unstable_mockModule('@/domain/scraping/index', () => ({
  refreshFeed,
}));

const { POST } = await import('@/app/api/feeds/route');

let raw: DatabaseSync;
let restore: () => void;

beforeEach(() => {
  session.id = 7;
  refreshFeed.mockClear();
  const made = sqliteD1(...APP_MIGRATIONS);
  raw = made.raw;
  restore = installCloudflareContext(made.d1);
});

afterEach(() => restore());

const URL = 'https://app.test/api/feeds';

/** A POST with the given body text. */
const post = (
  body: string,
  headers: Record<string, string> = { 'content-type': 'application/json' },
) => POST(new Request(URL, { method: 'POST', headers, body }));

/** The body of a response, as the fields these tests read. */
const body = async (res: Response) =>
  (await res.json()) as { id: string; errors?: string[] };

/** A POST of `{ url }`. */
const follow = (url: string) => post(JSON.stringify({ url }));

/** The feeds stored for a person. */
const stored = (id: number) =>
  raw.prepare('SELECT * FROM feeds WHERE user_id = ?').all(id) as Feed[];

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
    expect(refreshFeed).toHaveBeenCalledTimes(1);
  });

  it('answers 200 with the same feed when they already follow it, adding nothing', async () => {
    const first = await body(await follow('https://a.test/feed.xml'));
    refreshFeed.mockClear();
    const again = await follow('https://a.test/feed.xml');
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(first);
    expect(again.headers.get('location')).toBe(
      `https://app.test/api/feeds/${first.id}`,
    );
    expect(stored(7)).toHaveLength(1);
    expect(refreshFeed).not.toHaveBeenCalled();
  });

  it('lets two people follow the same address', async () => {
    await follow('https://a.test/feed.xml');
    session.id = 8;
    expect((await follow('https://a.test/feed.xml')).status).toBe(201);
  });

  it('answers 401 as a problem when nobody is signed in, storing nothing', async () => {
    session.id = null;
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
