import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { databaseFrom } from '@/domain/db/database';
import { DAILY_LIMITS } from '@/domain/assistant';
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

const { GET } = await import('@/app/api/users/self/usage/route');

let restore: () => void;
let repo: Repository;
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
  repo = new Repository(databaseFrom(made.d1));
  auth = await cookieFor(7);
});

afterEach(() => restore());

const usage = () =>
  GET(new Request('https://app.test/api/users/self/usage', { headers: auth }));

describe('GET /api/users/self/usage', () => {
  it('answers 200 with today’s budgets', async () => {
    await repo.recordUsage(7, 'answer');
    const res = await usage();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      answers: { used: 1, limit: DAILY_LIMITS.answer },
      assistant: { used: 0, limit: DAILY_LIMITS.assistant },
      transcriptions: { used: 0, limit: DAILY_LIMITS.transcription },
    });
  });

  it('includes the AI classifier budget', async () => {
    await repo.recordUsage(7, 'classifier');
    expect(await (await usage()).json()).toMatchObject({
      classifiers: { used: 1, limit: DAILY_LIMITS.classifier },
    });
  });

  it('counts only the caller’s questions', async () => {
    await repo.recordUsage(8, 'answer');
    expect(await (await usage()).json()).toMatchObject({
      answers: { used: 0 },
    });
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    expect((await usage()).status).toBe(401);
  });
});
