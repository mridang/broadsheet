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

const { GET, POST } = await import('@/app/api/editions/self/briefings/route');

let restore: () => void;
let db: Database;
let auth: Record<string, string>;
let run: jest.Mock<(model: string) => Promise<{ response: string }>>;

/** Person 7 follows a source with three stories fetched just now. */
beforeEach(async () => {
  const made = sqliteD1(...APP_MIGRATIONS);
  run = jest.fn<(model: string) => Promise<{ response: string }>>(async () => ({
    response: 'A briefing.',
  }));
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
    new Date().toISOString().slice(0, 10),
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

const URL_ = 'https://app.test/api/editions/self/briefings';
const ctx = { params: Promise.resolve({}) };

const list = (query = '') =>
  GET(new Request(`${URL_}${query}`, { headers: { ...auth } }), ctx);
const write = (headers: Record<string, string> = {}) =>
  POST(
    new Request(URL_, { method: 'POST', headers: { ...auth, ...headers } }),
    ctx,
  );

describe('POST /api/editions/self/briefings', () => {
  it('answers 201 with the briefing and its Location', async () => {
    const res = await write();
    expect(res.status).toBe(201);
    expect(res.headers.get('location')).toMatch(
      /\/api\/editions\/self\/briefings\/\d+$/,
    );
    const body = (await res.json()) as {
      summary: string;
      stories: { read: boolean }[];
    };
    expect(body.summary).toBe('A briefing.');
    expect(body.stories).toHaveLength(3);
  });

  it('answers 200 when it replaced the slot’s briefing', async () => {
    await write();
    const res = await write();
    expect(res.status).toBe(200);
  });

  it('answers 404 when too few stories qualify', async () => {
    await new Repository(db).updatePreferences(7, {
      briefing_read_filter: 'focus',
    });
    const res = await write();
    expect(res.status).toBe(404);
    expect(run).not.toHaveBeenCalled();
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    const res = await write();
    expect(res.status).toBe(401);
  });

  it('answers 403 for a request from another site', async () => {
    const res = await write({ 'Sec-Fetch-Site': 'cross-site' });
    expect(res.status).toBe(403);
  });
});

describe('GET /api/editions/self/briefings', () => {
  it('lists the briefings newest first, a page at a time', async () => {
    await write();
    const listed = await list('?limit=1');
    const page = (await listed.json()) as {
      items: { summary: string }[];
      next?: string;
    };
    expect(page.items.map((b) => b.summary)).toEqual(['A briefing.']);
    expect(page.next).toBeUndefined();
  });

  it('answers 400 for a bad parameter', async () => {
    const res = await list('?limit=0');
    expect(res.status).toBe(400);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    const res = await list();
    expect(res.status).toBe(401);
  });
});
