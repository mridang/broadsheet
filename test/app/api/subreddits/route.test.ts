import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import { SESSION_COOKIE } from '@/domain/auth/app';
import { APP_MIGRATIONS } from '../../../lib/core/db/migrations';
import {
  installCloudflareContext,
  sqliteD1,
} from '../../../lib/core/db/sqlite-d1';
import { SESSION_SECRET, tokenFor } from '../../../domain/auth/auth-test-kit';

const { GET } = await import('@/app/api/subreddits/route');

let restore: () => void;
let auth: Record<string, string>;
let run: jest.Mock<(...args: unknown[]) => Promise<unknown>>;

async function cookieFor(uid: number): Promise<Record<string, string>> {
  return {
    cookie: `${SESSION_COOKIE}=${await tokenFor({ id: uid }, { ep: 0 })}`,
  };
}

/** Persons 7 (a@b.com, a curator) and 8 (b@b.com). */
beforeEach(async () => {
  const made = sqliteD1(...APP_MIGRATIONS);
  run = jest.fn(async () => ({ text: 'What is new?' }));
  restore = installCloudflareContext(made.d1, {
    SESSION_SECRET,
    CURATOR_EMAILS: 'a@b.com',
    AI: { run },
  });
  made.raw
    .prepare(
      'INSERT INTO users (id, google_sub, email, session_epoch) VALUES (7, ?, ?, 0), (8, ?, ?, 0)',
    )
    .run('g7', 'a@b.com', 'g8', 'b@b.com');
  auth = await cookieFor(7);
});

afterEach(() => {
  restore();
  jest.restoreAllMocks();
});

const search = (query: string) =>
  GET(
    new Request(`https://app.test/api/subreddits${query}`, { headers: auth }),
  );

const listing = () =>
  Response.json({
    data: { children: [{ data: { display_name: 'rust' } }] },
  });

describe('GET /api/subreddits', () => {
  it('answers 200 with the subreddits Reddit found', async () => {
    const spy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(listing());
    const res = await search('?q=rust');
    expect(await res.json()).toMatchObject({
      items: [{ name: 'rust', feed_url: 'https://www.reddit.com/r/rust/.rss' }],
    });
    expect(String(spy.mock.calls[0]?.[0])).toContain(
      '/subreddits/search.json?',
    );
  });

  it('lists the popular subreddits without a search', async () => {
    const spy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(listing());
    expect((await search('')).status).toBe(200);
    expect(String(spy.mock.calls[0]?.[0])).toContain(
      '/subreddits/popular.json?',
    );
  });

  it('answers 502 as a problem when Reddit fails', async () => {
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('blocked'));
    expect((await search('?q=rust')).status).toBe(502);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    expect((await search('')).status).toBe(401);
  });
});
