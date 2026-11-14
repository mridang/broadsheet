import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { databaseFrom } from '@/domain/db/client';
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

const { GET } = await import('@/app/api/editions/[id]/issues/[date]/route');

const DAY = '2026-11-01';

let restore: () => void;
let mine: number;
let auth: Record<string, string>;

async function cookieFor(uid: number): Promise<Record<string, string>> {
  return {
    cookie: `${SESSION_COOKIE}=${await tokenFor({ id: uid }, { ep: 0 })}`,
  };
}

beforeEach(async () => {
  const made = sqliteD1(...APP_MIGRATIONS);
  restore = installCloudflareContext(made.d1, { SESSION_SECRET });
  made.raw
    .prepare(
      'INSERT INTO users (id, google_sub, email, session_epoch) VALUES (7, ?, ?, 0), (8, ?, ?, 0)',
    )
    .run('g7', 'a@b.com', 'g8', 'b@b.com');
  const repo = new Repository(databaseFrom(made.d1));
  const edition = await repo.addCustomEdition(7, { name: 'Weekend' });
  mine = edition.id;
  await repo.saveEditionIssue(mine, DAY, '{"groups":[]}', 'Quiet day.');
  auth = await cookieFor(7);
});

afterEach(() => restore());

const get = (id: string | number, date: string) =>
  GET(
    new Request(`https://app.test/api/editions/${id}/issues/${date}`, {
      headers: auth,
    }),
    { params: Promise.resolve({ id: String(id), date }) },
  );

describe('GET /api/editions/:id/issues/:date', () => {
  it('answers 200 with the edition’s stored issue', async () => {
    const res = await get(mine, DAY);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      date: DAY,
      briefing: 'Quiet day.',
      sections: [],
    });
  });

  it('answers 404 for another person’s edition', async () => {
    auth = await cookieFor(8);
    const res = await get(mine, DAY);
    expect(res.status).toBe(404);
  });

  it('answers 404 for a day with no issue', async () => {
    const res = await get(mine, '2026-10-31');
    expect(res.status).toBe(404);
  });

  it('answers 404 for a date that is not a calendar date', async () => {
    const res = await get(mine, '2026-02-30');
    expect(res.status).toBe(404);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    const res = await get(mine, DAY);
    expect(res.status).toBe(401);
  });
});
