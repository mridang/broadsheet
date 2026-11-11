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

const refreshSource = jest.fn<(...args: unknown[]) => Promise<unknown>>(
  async () => ({ ok: true, n: 0 }),
);
jest.unstable_mockModule('@/domain/scraping/index', () => ({
  refreshSource,
  discoverFeed: async (url: string) => url,
}));

const route = await import('@/app/api/topics/route');

let restore: () => void;
let auth: Record<string, string>;
const origin = 'https://app.test';

beforeEach(async () => {
  refreshSource.mockClear();
  const made = sqliteD1(...APP_MIGRATIONS);
  restore = installCloudflareContext(made.d1, { SESSION_SECRET });
  made.raw
    .prepare(
      'INSERT INTO users (id, google_sub, email, session_epoch) VALUES (7, ?, ?, 0), (8, ?, ?, 0)',
    )
    .run('g7', 'a@b.com', 'g8', 'b@b.com');
  auth = {
    cookie: `${SESSION_COOKIE}=${await tokenFor({ id: 7 }, { ep: 0 })}`,
  };
});

afterEach(() => restore());

const get = (headers: Record<string, string> = auth) =>
  route.GET(new Request(`${origin}/api/topics`, { headers }));

describe('GET /api/topics', () => {
  it('lists the topics with starter feeds as one page', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      self: string;
      next?: string;
      items: { id: string; feeds: unknown[] }[];
    };
    expect(body.self).toBe(`${origin}/api/topics`);
    expect(body.next).toBeUndefined();
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items[0]?.feeds.length).toBeGreaterThan(0);
  });

  it('answers 401 when nobody is signed in', async () => {
    const res = await get({});
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });
});

describe('GET /api/topics descriptions', () => {
  it('describes every topic', async () => {
    const res = await get();
    const body = (await res.json()) as {
      items: { description: string }[];
    };
    expect(body.items.every((t) => t.description.length > 0)).toBe(true);
  });
});
