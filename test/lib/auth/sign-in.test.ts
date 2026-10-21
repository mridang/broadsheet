import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import {
  LANDING_PATH,
  SESSION_COOKIE,
  sessionClaims,
} from '../../../src/lib/auth/app';
import type { User } from '../../../src/lib/auth/store';
import { SESSION_SECRET, appRequest } from './auth-test-kit';

const person = {
  id: 4,
  email: 'ada@example.com',
  name: 'Ada',
  picture: null,
  session_epoch: 2,
  refresh_token_enc: null,
  recipes_folder_id: null,
} as unknown as User;

const upsertGoogleUser = jest
  .fn<(profile: unknown) => Promise<User>>()
  .mockResolvedValue(person);
const afterSignIn = jest
  .fn<(user: unknown) => Promise<void>>()
  .mockResolvedValue(undefined);

jest.unstable_mockModule('../../../src/lib/auth/store', () => ({
  upsertGoogleUser,
}));
jest.unstable_mockModule('../../../src/lib/auth/hooks', () => ({
  afterSignIn,
  OTHER_FLOWS: {},
}));

const { completeSignIn, missingSignInSettings } =
  await import('../../../src/lib/auth/sign-in');
const { verifySessionToken } = await import('../../../src/lib/auth/session');

const env = (overrides: Record<string, string | undefined> = {}) =>
  ({
    SESSION_SECRET,
    GOOGLE_OAUTH_CLIENT_ID: 'id',
    GOOGLE_OAUTH_CLIENT_SECRET: 'secret',
    ...overrides,
  }) as unknown as CloudflareEnv;

const context = (overrides: Record<string, unknown> = {}) => ({
  request: appRequest('GET', '/auth/callback'),
  env: env(),
  origin: 'https://app.test',
  returnTo: undefined,
  ...overrides,
});

beforeEach(() => {
  upsertGoogleUser.mockClear();
  afterSignIn.mockClear();
});

describe('missingSignInSettings', () => {
  it('is empty when everything is set', () => {
    expect(missingSignInSettings(env())).toEqual([]);
  });

  it('names what is missing, in a fixed order, and treats empty as missing', () => {
    expect(
      missingSignInSettings(
        env({
          GOOGLE_OAUTH_CLIENT_ID: undefined,
          GOOGLE_OAUTH_CLIENT_SECRET: '',
          SESSION_SECRET: undefined,
        }),
      ),
    ).toEqual([
      'GOOGLE_OAUTH_CLIENT_ID',
      'GOOGLE_OAUTH_CLIENT_SECRET',
      'SESSION_SECRET',
    ]);
  });
});

describe('completeSignIn', () => {
  it('records the person, runs the hook and issues the session on the way to the landing page', async () => {
    const res = await completeSignIn(context(), {
      sub: 'g1',
      email: 'ada@example.com',
      name: 'Ada',
    });
    expect(res.headers.get('location')).toBe(`https://app.test${LANDING_PATH}`);
    expect(upsertGoogleUser).toHaveBeenCalledWith({
      sub: 'g1',
      email: 'ada@example.com',
      name: 'Ada',
      picture: undefined,
    });
    expect(afterSignIn).toHaveBeenCalledWith(person);
    expect(
      await verifySessionToken(
        res.cookies.get(SESSION_COOKIE)?.value ?? '',
        SESSION_SECRET,
      ),
    ).toMatchObject({ uid: 4, ep: 2, ...sessionClaims(person) });
  });

  it('lands on the returnTo it is given', async () => {
    const res = await completeSignIn(context({ returnTo: '/x/y' }), {
      sub: 'g1',
      email: 'ada@example.com',
    });
    expect(res.headers.get('location')).toBe('https://app.test/x/y');
  });

  it('is not Secure over plain http (local development)', async () => {
    const res = await completeSignIn(
      context({ origin: 'http://localhost:3737' }),
      { sub: 'g1', email: 'ada@example.com' },
    );
    expect(res.cookies.get(SESSION_COOKIE)?.secure).toBe(false);
  });

  it('refuses a Google account with no email address, recording nothing', async () => {
    await expect(completeSignIn(context(), { sub: 'g1' })).rejects.toThrow(
      /email/,
    );
    expect(upsertGoogleUser).not.toHaveBeenCalled();
  });

  it('fails closed without a session secret, recording nobody', async () => {
    await expect(
      completeSignIn(context({ env: env({ SESSION_SECRET: undefined }) }), {
        sub: 'g1',
        email: 'ada@example.com',
      }),
    ).rejects.toThrow(/SESSION_SECRET/);
    expect(upsertGoogleUser).not.toHaveBeenCalled();
    expect(afterSignIn).not.toHaveBeenCalled();
  });
});
