import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import { SESSION_COOKIE } from '../../../../src/lib/auth/app';
import type { User } from '../../../../src/lib/auth/store';
import {
  appRequest,
  fakeCookies,
  installEnv,
  jar,
  tokenFor,
} from '../../../lib/auth/auth-test-kit';

jest.unstable_mockModule('next/headers', () => ({ cookies: fakeCookies }));

/** The epoch each account's sessions must carry. */
const epochs = new Map<number, number>();
const getUserById = jest.fn(async (id: number) =>
  epochs.has(id)
    ? ({
        id,
        email: 'a@b.com',
        session_epoch: epochs.get(id),
      } as unknown as User)
    : undefined,
);
const bumpSessionEpoch = jest.fn(async (id: number) => {
  epochs.set(id, (epochs.get(id) ?? 0) + 1);
});

jest.unstable_mockModule('../../../../src/lib/auth/store', () => ({
  getUserById,
  getSessionEpoch: async (id: number) => epochs.get(id),
  bumpSessionEpoch,
}));

const { DELETE } = await import('../../../../src/app/api/sessions/route');
const { getCurrentUser } =
  await import('../../../../src/lib/auth/current-user');

let restore: () => void;

beforeEach(() => {
  jar.clear();
  epochs.clear();
  bumpSessionEpoch.mockClear();
  restore = installEnv();
});

afterEach(() => restore());

/** Sign this browser in as person `id`, whose account exists. */
async function signIn(id = 1): Promise<void> {
  epochs.set(id, 0);
  jar.set(SESSION_COOKIE, await tokenFor({ id }, { ep: 0 }));
}

describe('DELETE /api/sessions', () => {
  it('answers 401 when nobody is signed in', async () => {
    const res = await DELETE(appRequest('DELETE', '/api/sessions'));
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    expect(bumpSessionEpoch).not.toHaveBeenCalled();
  });

  it('answers 403 for a request from another site, and ends nothing', async () => {
    await signIn();
    const res = await DELETE(
      appRequest('DELETE', '/api/sessions', {
        headers: { 'sec-fetch-site': 'cross-site' },
      }),
    );
    expect(res.status).toBe(403);
    expect(bumpSessionEpoch).not.toHaveBeenCalled();
  });

  it('answers 403 before saying anything about who is signed in', async () => {
    const res = await DELETE(
      appRequest('DELETE', '/api/sessions', {
        headers: { 'sec-fetch-site': 'cross-site' },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('moves the account to the next epoch, clears this cookie and answers 204', async () => {
    await signIn();
    const res = await DELETE(appRequest('DELETE', '/api/sessions'));
    expect(res.status).toBe(204);
    expect(bumpSessionEpoch).toHaveBeenCalledWith(1);
    expect(epochs.get(1)).toBe(1);
    expect(res.headers.get('set-cookie')).toContain(`${SESSION_COOKIE}=;`);
  });

  it('ends the session of another device too: its cookie stops working', async () => {
    await signIn();
    // The "other device" keeps the same cookie.
    expect(await getCurrentUser()).not.toBeNull();
    await DELETE(appRequest('DELETE', '/api/sessions'));
    expect(await getCurrentUser()).toBeNull();
  });

  it("leaves other people's sessions alone", async () => {
    await signIn();
    epochs.set(2, 0);
    await DELETE(appRequest('DELETE', '/api/sessions'));
    expect(epochs.get(2)).toBe(0);
  });

  it('lets the person sign in again afterwards under the new epoch', async () => {
    await signIn();
    await DELETE(appRequest('DELETE', '/api/sessions'));
    jar.set(SESSION_COOKIE, await tokenFor({ id: 1 }, { ep: 1 }));
    expect(await getCurrentUser()).not.toBeNull();
  });

  it('answers 401 for a session that had already been ended', async () => {
    epochs.set(1, 3);
    jar.set(SESSION_COOKIE, await tokenFor({ id: 1 }, { ep: 2 }));
    const res = await DELETE(appRequest('DELETE', '/api/sessions'));
    expect(res.status).toBe(401);
  });
});
