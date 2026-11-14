import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import { createDatabase } from '@/domain/db/client';
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

const { GET, POST } = await import('@/app/api/feeds/recommendations/route');

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
  repo = new Repository(createDatabase(made.d1));
  auth = await cookieFor(7);
});

afterEach(() => {
  restore();
  jest.restoreAllMocks();
});

const list = (query = '') =>
  GET(
    new Request(`https://app.test/api/feeds/recommendations${query}`, {
      headers: auth,
    }),
  );

const recommend = (body: string) =>
  POST(
    new Request('https://app.test/api/feeds/recommendations', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json', ...auth },
    }),
  );

const good = '{"url":"https://a.test/f","description":"Good"}';

describe('POST /api/feeds/recommendations', () => {
  it('answers 201 with a pending recommendation and its Location', async () => {
    auth = await cookieFor(8);
    const res = await recommend(good);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; status: string };
    expect(body.status).toBe('pending');
    expect(res.headers.get('location')).toMatch(
      new RegExp(`/api/feeds/recommendations/${body.id}$`),
    );
  });

  it('answers 400 as a problem for a bad recommendation', async () => {
    const res = await recommend('{"url":"x"}');
    expect(res.status).toBe(400);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    const res = await recommend(good);
    expect(res.status).toBe(401);
  });
});

describe('GET /api/feeds/recommendations', () => {
  it('lists approved recommendations only by default', async () => {
    const a = await repo.addRecommendation(8, {
      url: 'https://a',
      description: 'd',
    });
    await repo.addRecommendation(8, { url: 'https://b', description: 'd' });
    await repo.decideRecommendation(a.id, 'approved');
    const res = await list();
    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { items: { url: string }[] }).items.map(
        (r) => r.url,
      ),
    ).toEqual(['https://a']);
  });

  it('lets a curator list pending ones', async () => {
    await repo.addRecommendation(8, { url: 'https://b', description: 'd' });
    const listed = await list('?status=pending');
    expect(((await listed.json()) as { items: unknown[] }).items).toHaveLength(
      1,
    );
  });

  it('answers 403 when someone else asks for pending ones', async () => {
    auth = await cookieFor(8);
    const res = await list('?status=pending');
    expect(res.status).toBe(403);
  });

  it('answers 400 for an unknown status', async () => {
    const res = await list('?status=x');
    expect(res.status).toBe(400);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    const res = await list();
    expect(res.status).toBe(401);
  });
});
