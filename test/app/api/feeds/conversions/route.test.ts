import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

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

const { POST } = await import('@/app/api/feeds/conversions/route');

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

const convert = (body: string, headers = {}) =>
  POST(
    new Request('https://app.test/api/feeds/conversions', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json', ...auth, ...headers },
    }),
  );

describe('POST /api/feeds/conversions', () => {
  it('answers 200 with the feed of a newsletter', async () => {
    const res = await convert('{"url":"https://jane.substack.com"}');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      feed_url: 'https://jane.substack.com/feed',
      platform: 'substack',
      title: 'Jane',
    });
  });

  it('answers 200 with a Google News feed', async () => {
    const res = await convert('{"google_news":{"query":"rust"}}');
    expect(await res.json()).toMatchObject({ platform: 'google-news' });
  });

  it('answers 400 as a problem when no feed can be found', async () => {
    const res = await convert('{"url":"ftp://x"}');
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });

  it('answers 415 for a body that is not JSON', async () => {
    const res = await convert('x', { 'Content-Type': 'text/plain' });
    expect(res.status).toBe(415);
  });

  it('answers 403 for a request from another site', async () => {
    const res = await convert('{"url":"https://a"}', {
      'Sec-Fetch-Site': 'cross-site',
    });
    expect(res.status).toBe(403);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    const res = await convert('{"url":"https://a"}');
    expect(res.status).toBe(401);
  });
});
