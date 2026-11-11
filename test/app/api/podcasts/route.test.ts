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

const { GET } = await import('@/app/api/podcasts/route');

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
  GET(new Request(`https://app.test/api/podcasts${query}`, { headers: auth }));

describe('GET /api/podcasts', () => {
  it('answers 200 with the podcasts iTunes found, asking it for podcasts', async () => {
    const spy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({
        results: [{ collectionName: 'Pod', feedUrl: 'https://p/f' }],
      }),
    );
    const res = await search('?q=rust&limit=3');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      items: [{ name: 'Pod', feed_url: 'https://p/f' }],
    });
    expect(String(spy.mock.calls[0]?.[0])).toBe(
      'https://itunes.apple.com/search?term=rust&media=podcast&entity=podcast&limit=3',
    );
  });

  it('answers 502 as a problem when iTunes fails', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 500 }));
    const res = await search('?q=rust');
    expect(res.status).toBe(502);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });

  it('answers 400 without a search', async () => {
    const res = await search('');
    expect(res.status).toBe(400);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    const res = await search('?q=rust');
    expect(res.status).toBe(401);
  });
});
