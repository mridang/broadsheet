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
import { APP_MIGRATIONS } from '../../../../../lib/core/db/migrations';
import {
  installCloudflareContext,
  sqliteD1,
} from '../../../../../lib/core/db/sqlite-d1';
import {
  SESSION_SECRET,
  tokenFor,
} from '../../../../../domain/auth/auth-test-kit';

const { PATCH } = await import('@/app/api/feeds/recommendations/[id]/route');

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

const decide = (id: string | number, body: string) =>
  PATCH(
    new Request(`https://app.test/api/feeds/recommendations/${id}`, {
      method: 'PATCH',
      body,
      headers: { 'Content-Type': 'application/merge-patch+json', ...auth },
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );

describe('PATCH /api/feeds/recommendations/:id', () => {
  it('lets a curator approve a recommendation', async () => {
    const r = await repo.addRecommendation(8, {
      url: 'https://a',
      description: 'd',
    });
    const res = await decide(r.id, '{"status":"approved"}');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'approved' });
  });

  it('answers 403 to someone who is not a curator', async () => {
    const r = await repo.addRecommendation(8, {
      url: 'https://a',
      description: 'd',
    });
    auth = await cookieFor(8);
    expect((await decide(r.id, '{"status":"approved"}')).status).toBe(403);
  });

  it.each(['{"status":"pending"}', '{"status":"approved","x":1}'])(
    'answers 400 for %s',
    async (body) => {
      expect((await decide(1, body)).status).toBe(400);
    },
  );

  it.each(['999', 'abc'])('answers 404 for recommendation %j', async (id) => {
    expect((await decide(id, '{"status":"declined"}')).status).toBe(404);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    expect((await decide(1, '{"status":"declined"}')).status).toBe(401);
  });
});
