import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { createDatabase } from '@/domain/db/client';
import { Repository } from '@/domain/repository';
import { SESSION_COOKIE } from '@/domain/auth/app';
import { APP_MIGRATIONS } from '../../../../../../lib/core/db/migrations';
import {
  installCloudflareContext,
  sqliteD1,
} from '../../../../../../lib/core/db/sqlite-d1';
import {
  SESSION_SECRET,
  tokenFor,
} from '../../../../../../domain/auth/auth-test-kit';

const { GET } = await import('@/app/api/editions/self/briefings/[id]/route');

let restore: () => void;
let auth: Record<string, string>;
let mine: number;
let theirs: number;

const briefing = (userId: number) => ({
  user_id: userId,
  slot: 'morning',
  local_date: '2026-11-01',
  frequency: 'daily',
  period_start: '2026-10-31T08:30:00.000Z',
  title: 'Morning',
  summary: 'Note.',
  stories: '[]',
  sections: '[]',
  status: 'complete',
  error: null,
  model: null,
  tokens: null,
  seconds: null,
});

beforeEach(async () => {
  const made = sqliteD1(...APP_MIGRATIONS);
  restore = installCloudflareContext(made.d1, { SESSION_SECRET });
  made.raw
    .prepare(
      'INSERT INTO users (id, google_sub, email, session_epoch) VALUES (7, ?, ?, 0), (8, ?, ?, 0)',
    )
    .run('g7', 'a@b.com', 'g8', 'b@b.com');
  const repo = new Repository(createDatabase(made.d1));
  const savedMine = await repo.saveBriefing(briefing(7));
  mine = savedMine.id;
  const savedTheirs = await repo.saveBriefing(briefing(8));
  theirs = savedTheirs.id;
  auth = {
    cookie: `${SESSION_COOKIE}=${await tokenFor({ id: 7 }, { ep: 0 })}`,
  };
});

afterEach(() => restore());

const get = (id: string | number) =>
  GET(
    new Request(`https://app.test/api/editions/self/briefings/${id}`, {
      headers: { ...auth },
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );

describe('GET /api/editions/self/briefings/:id', () => {
  it('answers 200 with the person’s briefing', async () => {
    const res = await get(mine);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { summary: string }).summary).toBe('Note.');
  });

  it.each([['someone else’s'], ['abc'], ['999']])(
    'answers 404 for %s briefing',
    async (which) => {
      const id = which === 'someone else’s' ? theirs : which;
      const res = await get(id);
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toBe('application/problem+json');
    },
  );

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    const res = await get(mine);
    expect(res.status).toBe(401);
  });
});
