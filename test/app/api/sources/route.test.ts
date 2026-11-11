import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import { databaseFrom } from '@/domain/db/database';
import { Repository } from '@/domain/repository';
import { SESSION_COOKIE } from '@/domain/auth/app';
import { APP_MIGRATIONS } from '../../../lib/core/db/migrations';
import {
  installCloudflareContext,
  sqliteD1,
} from '../../../lib/core/db/sqlite-d1';
import { SESSION_SECRET, tokenFor } from '../../../domain/auth/auth-test-kit';

const { GET } = await import('@/app/api/sources/route');

let restore: () => void;
let repo: Repository;
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
  repo = new Repository(databaseFrom(made.d1));
  auth = await cookieFor(7);
});

afterEach(() => {
  restore();
  jest.restoreAllMocks();
});

const search = (query: string) =>
  GET(new Request(`https://app.test/api/sources${query}`, { headers: auth }));

describe('GET /api/sources', () => {
  it('answers 200 with sources whose title or address matches', async () => {
    await repo.addFeed(8, 'https://lwn.test/f', 'LWN');
    await repo.addFeed(8, 'https://other.test/f');
    const res = await search('?q=lwn');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      items: [{ url: 'https://lwn.test/f', title: 'LWN' }],
    });
  });

  it.each(['', '?q=a', '?q=ab&x=1'])(
    'answers 400 as a problem for %j',
    async (query) => {
      const res = await search(query);
      expect(res.status).toBe(400);
    },
  );

  it('still lists trending sources without q', async () => {
    const res = await search('?order=follows');
    expect(res.status).toBe(200);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    const res = await search('?q=ab');
    expect(res.status).toBe(401);
  });
});
