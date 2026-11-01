import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

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

const { GET } = await import('@/app/api/articles/[id]/similar/route');

let restore: () => void;
let id: number;

const story = (url: string, title: string) => ({
  url,
  title,
  source: '',
  favicon: '',
  summary: '',
  image: '',
  published_at: '',
  points: 0,
});

beforeEach(async () => {
  const made = sqliteD1(...APP_MIGRATIONS);
  restore = installCloudflareContext(made.d1, { SESSION_SECRET });
  made.raw
    .prepare(
      'INSERT INTO users (id, google_sub, email, session_epoch) VALUES (7, ?, ?, 0), (8, ?, ?, 0)',
    )
    .run('g7', 'a@b.com', 'g8', 'b@b.com');
  const repo = new Repository(databaseFrom(made.d1));
  const { source_id } = (await repo.addFeed(7, 'https://a.test/f'))!;
  await repo.writeEdition(source_id, '2026-10-01', [
    story('https://x/1', 'Rust compiler builds faster'),
    story('https://x/2', 'Faster builds for the Rust compiler'),
    story('https://x/3', 'Winter gardening'),
  ]);
  id = (await repo.searchArticles(7, { q: 'winter', limit: 1 }))[0]!.id - 2;
});

afterEach(() => restore());

const get = async (path: string, uid?: number) =>
  GET(
    new Request(`https://app.test/api/articles/${path}/similar`, {
      headers: uid
        ? {
            cookie: `${SESSION_COOKIE}=${await tokenFor({ id: uid }, { ep: 0 })}`,
          }
        : {},
    }),
    { params: Promise.resolve({ id: path }) },
  );

describe('GET /api/articles/:id/similar', () => {
  it('lists the stories most like the article as one page', async () => {
    const res = await get(String(id), 7);
    expect(res.status).toBe(200);
    const page = (await res.json()) as {
      next?: string;
      items: { title: string }[];
    };
    expect(page.items.map((a) => a.title)).toEqual([
      'Faster builds for the Rust compiler',
    ]);
    expect(page).not.toHaveProperty('next');
  });

  it.each([
    ['from a source the caller does not follow', () => String(id), 8],
    ['whose id cannot name one', () => 'abc', 7],
  ])('answers 404 for an article %s', async (_what, path, uid) => {
    const res = await get(path(), uid);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('problem+json');
  });

  it('refuses a caller who is not signed in', async () => {
    expect((await get(String(id))).status).toBe(401);
  });
});
