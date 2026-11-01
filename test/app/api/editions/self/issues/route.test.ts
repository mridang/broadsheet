import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import { databaseFrom, type Database } from '@/domain/db/database';
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

const { GET, POST } = await import('@/app/api/editions/self/issues/route');

let restore: () => void;
let db: Database;
let auth: Record<string, string>;
let run: jest.Mock<() => Promise<{ response: string }>>;

const DAY = '2026-11-01';

/** Person 7 follows a source with three stories today. */
beforeEach(async () => {
  const made = sqliteD1(...APP_MIGRATIONS);
  run = jest.fn(async () => ({ response: 'A fresh note.' }));
  restore = installCloudflareContext(made.d1, { SESSION_SECRET, AI: { run } });
  made.raw
    .prepare(
      'INSERT INTO users (id, google_sub, email, session_epoch) VALUES (7, ?, ?, 0)',
    )
    .run('g7', 'a@b.com');
  db = databaseFrom(made.d1);
  const repo = new Repository(db);
  const { source_id } = (await repo.addFeed(7, 'https://a.test/f'))!;
  await repo.writeEdition(
    source_id,
    DAY,
    [1, 2, 3].map((n) => ({
      url: `https://x/${n}`,
      title: `Story ${n}`,
      source: 'x',
      favicon: '',
      summary: '',
      image: '',
      published_at: '',
      points: n,
    })),
  );
  auth = {
    cookie: `${SESSION_COOKIE}=${await tokenFor({ id: 7 }, { ep: 0 })}`,
  };
});

afterEach(() => restore());

const URL_ = 'https://app.test/api/editions/self/issues';
const ctx = { params: Promise.resolve({}) };

const list = (query = '') =>
  GET(new Request(`${URL_}${query}`, { headers: { ...auth } }), ctx);
const publish = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request(URL_, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
    ctx,
  );

describe('GET /api/editions/self/issues', () => {
  it('lists the stored issues newest first, a page at a time', async () => {
    const repo = new Repository(db);
    await repo.saveIssue(7, '2026-10-31', '{"groups":[]}', 'Old.');
    await repo.saveIssue(7, DAY, '{"groups":[]}', 'New.');
    const first = (await (await list('?limit=1')).json()) as {
      items: unknown[];
      next: string;
    };
    expect(first.items).toEqual([
      { date: DAY, briefing: 'New.', created_at: expect.any(String) },
    ]);
    const next = new URL(first.next);
    const second = (await (await list(next.search)).json()) as {
      items: { date: string }[];
      next?: string;
    };
    expect(second.items.map((i: { date: string }) => i.date)).toEqual([
      '2026-10-31',
    ]);
    expect(second.next).toBeUndefined();
  });

  it('answers 400 for a bad parameter', async () => {
    expect((await list('?limit=0')).status).toBe(400);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    expect((await list()).status).toBe(401);
  });
});

describe('POST /api/editions/self/issues', () => {
  it('answers 201 with the issue, its note and its Location', async () => {
    const res = await publish({ date: DAY });
    expect(res.status).toBe(201);
    expect(res.headers.get('location')).toMatch(
      new RegExp(`/api/editions/self/issues/${DAY}$`),
    );
    const body = (await res.json()) as {
      briefing: string;
      briefing_stories: unknown[];
    };
    expect(body.briefing).toBe('A fresh note.');
    expect(body.briefing_stories).toHaveLength(3);
  });

  it('answers 200 when it replaced the stored issue', async () => {
    await publish({ date: DAY });
    expect((await publish({ date: DAY })).status).toBe(200);
  });

  it('answers 404 for a day with no edition', async () => {
    const res = await publish({ date: '2026-10-01' });
    expect(res.status).toBe(404);
    expect(run).not.toHaveBeenCalled();
  });

  it('answers 400 for a bad date', async () => {
    const res = await publish({ date: 'today' });
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    expect((await publish({ date: DAY })).status).toBe(401);
  });

  it('answers 403 for a request from another site', async () => {
    expect(
      (await publish({ date: DAY }, { 'Sec-Fetch-Site': 'cross-site' })).status,
    ).toBe(403);
  });
});
