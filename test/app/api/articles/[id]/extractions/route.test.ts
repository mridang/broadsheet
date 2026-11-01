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

const { POST } = await import('@/app/api/articles/[id]/extractions/route');

const TEXT =
  'The page now tells the whole story, long enough to count as an article rather than a failed extraction.';

let restore: () => void;
let id: number;

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
    {
      url: 'https://x/1',
      title: 'Story',
      source: '',
      favicon: '',
      summary: '',
      image: '',
      published_at: '',
      points: 0,
      body_text: 'Old text.',
    },
  ]);
  id = (await repo.searchArticles(7, { limit: 1 }))[0]!.id;
  jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => new Response(`<p>${TEXT}</p>`));
});

afterEach(() => {
  restore();
  jest.restoreAllMocks();
});

const post = async (path: string, uid?: number) =>
  POST(
    new Request(`https://app.test/api/articles/${path}/extractions`, {
      method: 'POST',
      headers: uid
        ? {
            cookie: `${SESSION_COOKIE}=${await tokenFor({ id: uid }, { ep: 0 })}`,
          }
        : {},
    }),
    { params: Promise.resolve({ id: path }) },
  );

describe('POST /api/articles/:id/extractions', () => {
  it('fetches the text again and answers the article with it', async () => {
    const res = await post(String(id), 7);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: String(id), body_text: TEXT });
  });

  it.each([
    ['from a source the caller does not follow', () => String(id), 8],
    ['whose id cannot name one', () => 'abc', 7],
  ])('answers 404 for an article %s', async (_what, path, uid) => {
    const res = await post(path(), uid);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('problem+json');
  });

  it('refuses a caller who is not signed in', async () => {
    expect((await post(String(id))).status).toBe(401);
  });
});
