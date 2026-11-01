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

const { GET } = await import('@/app/api/news/topics/route');

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

const list = () =>
  GET(new Request('https://app.test/api/news/topics', { headers: auth }));

describe('GET /api/news/topics', () => {
  it('answers 200 with the Google News topics', async () => {
    const res = await list();
    expect(res.status).toBe(200);
    expect(((await res.json()) as { items: unknown[] }).items).toContainEqual({
      id: 'SCIENCE',
      name: 'Science',
    });
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    expect((await list()).status).toBe(401);
  });
});
