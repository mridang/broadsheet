import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { databaseFrom } from '@/domain/db/database';
import { Repository } from '@/domain/repository';
import { SESSION_COOKIE } from '@/domain/auth/app';
import { APP_MIGRATIONS } from '../../../lib/core/db/migrations';
import {
  installCloudflareContext,
  sqliteD1,
} from '../../../lib/core/db/sqlite-d1';
import { SESSION_SECRET, tokenFor } from '../../../domain/auth/auth-test-kit';

const { GET } = await import('@/app/api/briefings/route');

let restore: () => void;
let auth: Record<string, string>;

const cookieFor = async (uid: number) => ({
  cookie: `${SESSION_COOKIE}=${await tokenFor({ id: uid }, { ep: 0 })}`,
});

/** Person 7 is an operator; person 8 is not. Each has a briefing. */
beforeEach(async () => {
  const made = sqliteD1(...APP_MIGRATIONS);
  restore = installCloudflareContext(made.d1, {
    SESSION_SECRET,
    ADMIN_EMAILS: ' Ops@Example.com , other@example.com',
  });
  made.raw
    .prepare(
      'INSERT INTO users (id, google_sub, email, session_epoch) VALUES (7, ?, ?, 0), (8, ?, ?, 0)',
    )
    .run('g7', 'ops@example.com', 'g8', 'b@b.com');
  const repo = new Repository(databaseFrom(made.d1));
  for (const user_id of [7, 8]) {
    await repo.saveBriefing({
      user_id,
      slot: 'morning',
      local_date: '2026-11-01',
      frequency: 'daily',
      period_start: '2026-10-31T08:30:00.000Z',
      title: 'Morning',
      summary: null,
      stories: '[{"id":1,"category":"top_stories"}]',
      sections: '[]',
      status: 'complete',
      error: null,
      model: null,
      tokens: null,
      seconds: null,
    });
  }
  auth = await cookieFor(7);
});

afterEach(() => restore());

const list = (query = '') =>
  GET(
    new Request(`https://app.test/api/briefings${query}`, {
      headers: { ...auth },
    }),
    {
      params: Promise.resolve({}),
    },
  );

describe('GET /api/briefings', () => {
  it('lists everyone’s briefings for an operator', async () => {
    const res = await list();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: { email: string; story_count: number }[];
    };
    expect(body.items.map((b) => b.email)).toEqual([
      'b@b.com',
      'ops@example.com',
    ]);
    expect(body.items[0]?.story_count).toBe(1);
  });

  it('answers 403 for anyone else', async () => {
    auth = await cookieFor(8);
    const res = await list();
    expect(res.status).toBe(403);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });

  it('answers 400 for a bad parameter', async () => {
    expect((await list('?limit=x')).status).toBe(400);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    expect((await list()).status).toBe(401);
  });
});
