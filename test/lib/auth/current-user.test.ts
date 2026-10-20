import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import { SESSION_COOKIE } from '../../../src/lib/auth/app';
import type { User } from '../../../src/lib/auth/store';
import { fakeCookies, installEnv, jar, tokenFor } from './auth-test-kit';

jest.unstable_mockModule('next/headers', () => ({ cookies: fakeCookies }));

/** The accounts that exist: id to the epoch their sessions must carry. */
const accounts = new Map<number, { email: string; epoch: number }>();
const getUserById = jest.fn(async (id: number) => {
  const account = accounts.get(id);
  return account
    ? ({ id, email: account.email, session_epoch: account.epoch } as User)
    : undefined;
});
const getSessionEpoch = jest.fn(async (id: number) => accounts.get(id)?.epoch);

jest.unstable_mockModule('../../../src/lib/auth/store', () => ({
  getUserById,
  getSessionEpoch,
}));

const { getCurrentUser, getLiveSessionUid, getSession, getSessionUid } =
  await import('../../../src/lib/auth/current-user');

let restore: () => void;

beforeEach(() => {
  jar.clear();
  accounts.clear();
  getUserById.mockClear();
  getSessionEpoch.mockClear();
  restore = installEnv();
});

afterEach(() => {
  restore();
});

/** Add an account. */
function account(id: number, epoch = 0, email = 'a@b.com'): void {
  accounts.set(id, { email, epoch });
}

/** Send the session cookie for a person. */
async function signIn(
  user: { id: number },
  options: { ep?: number; exp?: number; secret?: string } = {},
): Promise<void> {
  jar.set(SESSION_COOKIE, await tokenFor(user, options));
}

describe('getCurrentUser', () => {
  it('is null without a cookie', async () => {
    account(1);
    expect(await getCurrentUser()).toBeNull();
  });

  it('is the person a valid cookie names', async () => {
    account(1, 0, 'ada@b.com');
    await signIn({ id: 1 });
    expect((await getCurrentUser())?.email).toBe('ada@b.com');
  });

  it('is null for a cookie signed with another secret', async () => {
    account(1);
    await signIn({ id: 1 }, { secret: 'another-secret' });
    expect(await getCurrentUser()).toBeNull();
    expect(getUserById).not.toHaveBeenCalled();
  });

  it('is null for a cookie that has expired', async () => {
    account(1);
    await signIn({ id: 1 }, { exp: Math.floor(Date.now() / 1000) - 10 });
    expect(await getCurrentUser()).toBeNull();
  });

  it('is null for a malformed cookie', async () => {
    account(1);
    jar.set(SESSION_COOKIE, 'not-a-token');
    expect(await getCurrentUser()).toBeNull();
  });

  it('is null when the account no longer exists', async () => {
    await signIn({ id: 5 });
    expect(await getCurrentUser()).toBeNull();
  });

  it('is null once the person has signed out everywhere', async () => {
    account(1, 1);
    await signIn({ id: 1 }, { ep: 0 });
    expect(await getCurrentUser()).toBeNull();
  });

  it('accepts a cookie issued before epochs existed while the epoch is still 0', async () => {
    account(1);
    await signIn({ id: 1 });
    expect(await getCurrentUser()).not.toBeNull();
  });

  it('accepts a cookie issued under the current epoch', async () => {
    account(1, 3);
    await signIn({ id: 1 }, { ep: 3 });
    expect(await getCurrentUser()).not.toBeNull();
  });
});

describe('getSession and getSessionUid', () => {
  it('read the claims from the cookie alone, with no database read', async () => {
    // No such account at all.
    await signIn({ id: 9 });
    expect((await getSession())?.uid).toBe(9);
    expect(await getSessionUid()).toBe(9);
    expect(getUserById).not.toHaveBeenCalled();
    expect(getSessionEpoch).not.toHaveBeenCalled();
  });

  it('are null for no cookie or a bad one', async () => {
    expect(await getSession()).toBeNull();
    expect(await getSessionUid()).toBeNull();
    jar.set(SESSION_COOKIE, 'x.y');
    expect(await getSessionUid()).toBeNull();
  });

  it('are null whatever the cookie says when there is no session secret', async () => {
    await signIn({ id: 9 });
    restore();
    restore = installEnv({});
    expect(await getSession()).toBeNull();
    expect(await getSessionUid()).toBeNull();
    expect(await getCurrentUser()).toBeNull();
  });

  it('are null for a cookie signed with the empty string when there is no secret', async () => {
    await signIn({ id: 9 }, { secret: 'x' });
    restore();
    restore = installEnv({ SESSION_SECRET: '' });
    expect(await getSession()).toBeNull();
  });
});

describe('getLiveSessionUid', () => {
  it('is the id of a session that is still current', async () => {
    account(1, 2);
    await signIn({ id: 1 }, { ep: 2 });
    expect(await getLiveSessionUid()).toBe(1);
  });

  it('is null after the person signed out everywhere, though the cookie still verifies', async () => {
    account(1, 3);
    await signIn({ id: 1 }, { ep: 2 });
    expect(await getSessionUid()).toBe(1);
    expect(await getLiveSessionUid()).toBeNull();
  });

  it('is null for an account that is gone, and for no cookie', async () => {
    await signIn({ id: 4 });
    expect(await getLiveSessionUid()).toBeNull();
    jar.clear();
    expect(await getLiveSessionUid()).toBeNull();
  });
});
