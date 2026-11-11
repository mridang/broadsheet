import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import { databaseFrom } from '@/domain/db/database';
import { DAILY_LIMITS } from '@/domain/assistant';
import { Repository } from '@/domain/repository';
import { SESSION_COOKIE } from '@/domain/auth/app';
import { APP_MIGRATIONS } from '../../../lib/core/db/migrations';
import {
  installCloudflareContext,
  sqliteD1,
} from '../../../lib/core/db/sqlite-d1';
import { SESSION_SECRET, tokenFor } from '../../../domain/auth/auth-test-kit';

const { POST } = await import('@/app/api/transcriptions/route');

let restore: () => void;
let repo: Repository;
let auth: Record<string, string>;
let run: jest.Mock<(...args: unknown[]) => Promise<unknown>>;

async function cookieFor(uid: number): Promise<Record<string, string>> {
  return {
    cookie: `${SESSION_COOKIE}=${await tokenFor({ id: uid }, { ep: 0 })}`,
  };
}

/** Persons 7 (a@b.com, a curator) and 8 (b@b.com). */
beforeEach(async () => {
  const made = sqliteD1(...APP_MIGRATIONS);
  run = jest.fn(async () => ({ text: 'What is new?' }));
  restore = installCloudflareContext(made.d1, {
    SESSION_SECRET,
    CURATOR_EMAILS: 'a@b.com',
    AI: { run },
  });
  made.raw
    .prepare(
      'INSERT INTO users (id, google_sub, email, session_epoch) VALUES (7, ?, ?, 0), (8, ?, ?, 0)',
    )
    .run('g7', 'a@b.com', 'g8', 'b@b.com');
  repo = new Repository(databaseFrom(made.d1));
  auth = await cookieFor(7);
});

afterEach(() => {
  restore();
  jest.restoreAllMocks();
});

const send = (body: BodyInit | null, type = 'audio/webm', headers = {}) =>
  POST(
    new Request('https://app.test/api/transcriptions', {
      method: 'POST',
      body,
      headers: { 'Content-Type': type, ...auth, ...headers },
    }),
  );

describe('POST /api/transcriptions', () => {
  it('answers 200 with what was said, and counts it', async () => {
    const res = await send(new Uint8Array([1, 2, 3]));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: 'What is new?' });
    expect(
      await repo.usageSince(7, 'transcription', '2000-01-01 00:00:00'),
    ).toBe(1);
  });

  it('answers 415 as a problem for a body that is not audio', async () => {
    const res = await send('x', 'text/plain');
    expect(res.status).toBe(415);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });

  it('answers 413 for a recording over 10 MB', async () => {
    const res = await send(new Uint8Array(1), 'audio/webm', {
      'Content-Length': String(11 * 1024 * 1024),
    });
    expect(res.status).toBe(413);
  });

  it('answers 400 for an empty recording', async () => {
    const res = await send(new Uint8Array(0));
    expect(res.status).toBe(400);
  });

  it('answers 502 when nothing could be heard', async () => {
    run.mockResolvedValue({ text: '' });
    const res = await send(new Uint8Array([1]));
    expect(res.status).toBe(502);
  });

  it('answers 429 once today’s budget is used up', async () => {
    for (let i = 0; i < DAILY_LIMITS.transcription; i++) {
      await repo.recordUsage(7, 'transcription');
    }
    const res = await send(new Uint8Array([1]));
    expect(res.status).toBe(429);
    expect(run).not.toHaveBeenCalled();
  });

  it('answers 403 for a request from another site', async () => {
    const res = await send(new Uint8Array([1]), 'audio/webm', {
      'Sec-Fetch-Site': 'cross-site',
    });
    expect(res.status).toBe(403);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    const res = await send(new Uint8Array([1]));
    expect(res.status).toBe(401);
  });
});
