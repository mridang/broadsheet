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
import {
  appRequest,
  fakeCookies,
  installEnv,
  jar,
  tokenFor,
} from './auth-test-kit';

jest.unstable_mockModule('next/headers', () => ({ cookies: fakeCookies }));

const getUserById = jest.fn(async (id: number) =>
  id === 1
    ? ({ id, email: 'a@b.com', session_epoch: 0 } as unknown as User)
    : undefined,
);

jest.unstable_mockModule('../../../src/lib/auth/store', () => ({
  getUserById,
  getSessionEpoch: async () => 0,
}));

const { crossSiteRefusal, requireSignedIn } =
  await import('../../../src/lib/auth/guard');

let restore: () => void;

beforeEach(() => {
  jar.clear();
  restore = installEnv();
});

afterEach(() => restore());

describe('crossSiteRefusal', () => {
  it('lets a request from our own pages through', () => {
    expect(
      crossSiteRefusal(
        appRequest('DELETE', '/x', {
          headers: { 'sec-fetch-site': 'same-origin' },
        }),
      ),
    ).toBeUndefined();
    expect(crossSiteRefusal(appRequest('DELETE', '/x'))).toBeUndefined();
  });

  it('refuses one from another site with a 403 problem document', async () => {
    const res = crossSiteRefusal(
      appRequest('DELETE', '/x', {
        headers: { 'sec-fetch-site': 'cross-site' },
      }),
    );
    expect(res?.status).toBe(403);
    expect(res?.headers.get('content-type')).toBe('application/problem+json');
    expect(res?.headers.get('cache-control')).toBe('no-store');
    expect(await res?.json()).toEqual({
      type: '/problems/forbidden',
      title: 'Forbidden',
      status: 403,
      detail: 'Cross-site requests are not allowed.',
    });
  });
});

describe('requireSignedIn', () => {
  it('gives the signed-in person', async () => {
    jar.set(SESSION_COOKIE, await tokenFor({ id: 1 }, { ep: 0 }));
    const caller = await requireSignedIn(appRequest('DELETE', '/x'));
    expect(caller.ok && caller.user.id).toBe(1);
  });

  it('answers 401 with a problem document when nobody is signed in', async () => {
    const caller = await requireSignedIn(appRequest('DELETE', '/x'));
    expect(caller.ok).toBe(false);
    if (!caller.ok) {
      expect(caller.response.status).toBe(401);
      expect(await caller.response.json()).toMatchObject({
        type: '/problems/unauthorized',
        detail: 'Sign in first.',
      });
    }
  });

  it('answers 401 for a session whose account is gone', async () => {
    jar.set(SESSION_COOKIE, await tokenFor({ id: 2 }));
    const caller = await requireSignedIn(appRequest('DELETE', '/x'));
    expect(caller.ok).toBe(false);
  });

  it('answers 403 first for a request from another site', async () => {
    jar.set(SESSION_COOKIE, await tokenFor({ id: 1 }, { ep: 0 }));
    const caller = await requireSignedIn(
      appRequest('DELETE', '/x', {
        headers: { 'sec-fetch-site': 'cross-site' },
      }),
    );
    expect(!caller.ok && caller.response.status).toBe(403);
  });
});
