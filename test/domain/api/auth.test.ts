import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import type { DatabaseSync } from 'node:sqlite';

import {
  requireLiveUid,
  requireUid,
  requireUser,
  type Auth,
} from '@/domain/api/auth';
import { SESSION_COOKIE } from '@/domain/auth/app';
import { APP_MIGRATIONS } from '../../lib/core/db/migrations';
import {
  installCloudflareContext,
  sqliteD1,
} from '../../lib/core/db/sqlite-d1';
import { SESSION_SECRET, tokenFor } from '../auth/auth-test-kit';

const ORIGIN = 'https://app.test';

let raw: DatabaseSync;
let restore: () => void;
/** The caller's session cookie, or null for a signed-out caller. */
let cookie: string | null;

beforeEach(async () => {
  const made = sqliteD1(...APP_MIGRATIONS);
  raw = made.raw;
  restore = installCloudflareContext(made.d1, { SESSION_SECRET });
  raw
    .prepare(
      "INSERT INTO users (id, google_sub, email, session_epoch) VALUES (1, 'g1', 'a@b.com', 0)",
    )
    .run();
  cookie = `${SESSION_COOKIE}=${await tokenFor({ id: 1 }, { ep: 0 })}`;
});

afterEach(() => restore());

/** A request with the given method and headers, carrying the current cookie. */
const request = (method: string, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/api/thing`, {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...headers },
  });

/** The status of a failed outcome, or 'ok'. */
async function statusOf(outcome: Auth<unknown>): Promise<number | 'ok'> {
  return outcome.ok ? 'ok' : outcome.response.status;
}

const gates = [
  ['requireUid', requireUid],
  ['requireLiveUid', requireLiveUid],
  ['requireUser', requireUser],
] as const;

describe.each(gates)('%s and the cross-site check', (_name, gate) => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'refuses a cross-site %s',
    async (method) => {
      const outcome = await gate(
        request(method, { 'sec-fetch-site': 'cross-site' }),
      );
      expect(!outcome.ok && outcome.response.status).toBe(403);
    },
  );

  it('refuses a same-site (not same-origin) write', async () => {
    const outcome = await gate(
      request('POST', { 'sec-fetch-site': 'same-site' }),
    );
    expect(!outcome.ok && outcome.response.status).toBe(403);
  });

  it('lets a same-origin write through', async () => {
    expect(
      (await gate(request('POST', { 'sec-fetch-site': 'same-origin' }))).ok,
    ).toBe(true);
  });

  it('refuses a write with no Fetch Metadata and a foreign Origin', async () => {
    const outcome = await gate(
      request('POST', { origin: 'https://evil.example' }),
    );
    expect(!outcome.ok && outcome.response.status).toBe(403);
  });

  it('lets a write with no Fetch Metadata and our own Origin through', async () => {
    expect((await gate(request('POST', { origin: ORIGIN }))).ok).toBe(true);
  });

  it('lets a write with neither header through (not a browser)', async () => {
    expect((await gate(request('POST'))).ok).toBe(true);
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])(
    'does not check where a %s came from',
    async (method) => {
      const outcome = await gate(
        request(method, { 'sec-fetch-site': 'cross-site' }),
      );
      expect(outcome.ok).toBe(true);
    },
  );

  it('answers 403 before 401, so a forged request learns nothing about the session', async () => {
    cookie = null;
    const outcome = await gate(
      request('POST', { 'sec-fetch-site': 'cross-site' }),
    );
    expect(!outcome.ok && outcome.response.status).toBe(403);
  });

  it('answers 401 with a problem document when nobody is signed in', async () => {
    cookie = null;
    const outcome = await gate(request('GET'));
    expect(await statusOf(outcome)).toBe(401);
    expect(!outcome.ok && outcome.response.headers.get('content-type')).toBe(
      'application/problem+json',
    );
  });
});

describe('what each gate returns', () => {
  it('requireUid and requireLiveUid give the user id; requireUser the record', async () => {
    const get = request('GET');
    const uid = await requireUid(get);
    const live = await requireLiveUid(get);
    const user = await requireUser(get);
    expect(uid.ok && uid.value).toBe(1);
    expect(live.ok && live.value).toBe(1);
    expect(user.ok && user.value.email).toBe('a@b.com');
  });
});

describe('a session that has been ended', () => {
  beforeEach(() => {
    raw.prepare('UPDATE users SET session_epoch = 1 WHERE id = 1').run();
  });

  it('is still accepted by requireUid, which reads nothing from the database', async () => {
    expect(await statusOf(await requireUid(request('GET')))).toBe('ok');
  });

  it('is refused by requireLiveUid', async () => {
    expect(await statusOf(await requireLiveUid(request('GET')))).toBe(401);
  });

  it('is refused by requireUser', async () => {
    expect(await statusOf(await requireUser(request('GET')))).toBe(401);
  });
});

describe('a cookie whose account has been deleted', () => {
  beforeEach(() => {
    raw.prepare('DELETE FROM users WHERE id = 1').run();
  });

  it('gets 401 from requireUser and requireLiveUid', async () => {
    expect(await statusOf(await requireUser(request('GET')))).toBe(401);
    expect(await statusOf(await requireLiveUid(request('GET')))).toBe(401);
  });
});
