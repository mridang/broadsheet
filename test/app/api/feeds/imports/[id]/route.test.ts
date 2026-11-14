import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { SESSION_COOKIE } from '@/domain/auth/app';
import { createDatabase } from '@/domain/db/client';
import { FeedImportRuns } from '@/domain/feed-import-runs';
import { APP_MIGRATIONS } from '../../../../../lib/core/db/migrations';
import {
  installCloudflareContext,
  sqliteD1,
} from '../../../../../lib/core/db/sqlite-d1';
import {
  SESSION_SECRET,
  tokenFor,
} from '../../../../../domain/auth/auth-test-kit';

const route = await import('@/app/api/feeds/imports/[id]/route');

let restore: () => void;
let runs: FeedImportRuns;
let auth: Record<string, string>;
const origin = 'https://app.test';

beforeEach(async () => {
  const made = sqliteD1(...APP_MIGRATIONS);
  restore = installCloudflareContext(made.d1, { SESSION_SECRET });
  made.raw
    .prepare(
      'INSERT INTO users (id, google_sub, email, session_epoch) VALUES (7, ?, ?, 0), (8, ?, ?, 0)',
    )
    .run('g7', 'a@b.com', 'g8', 'b@b.com');
  runs = new FeedImportRuns(createDatabase(made.d1));
  auth = {
    cookie: `${SESSION_COOKIE}=${await tokenFor({ id: 7 }, { ep: 0 })}`,
  };
});

afterEach(() => restore());

const get = (id: string, headers: Record<string, string> = auth) =>
  route.GET(new Request(`${origin}/api/feeds/imports/${id}`, { headers }));

describe('GET /api/feeds/imports/:id', () => {
  it('answers 200 with the import’s progress', async () => {
    const run = await runs.start(7, 80);
    const res = await get(run.id);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toMatchObject({
      id: run.id,
      status: 'running',
      total: 80,
    });
  });

  it('answers 404 for someone else’s import', async () => {
    const run = await runs.start(8, 80);
    const res = await get(run.id);
    expect(res.status).toBe(404);
  });

  it('answers 404 for no such import', async () => {
    const res = await get('nope');
    expect(res.status).toBe(404);
  });

  it('answers 401 when nobody is signed in', async () => {
    const run = await runs.start(7, 80);
    const res = await get(run.id, {});
    expect(res.status).toBe(401);
  });
});
