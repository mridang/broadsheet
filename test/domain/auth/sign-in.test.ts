import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { LANDING_PATH, SESSION_COOKIE, sessionClaims } from '@/domain/auth/app';
import { installFakeTracing } from '../../lib/core/observability/fake-tracing';
import { fixtureEnv, fixtureUser } from '../fixtures';
import { SESSION_SECRET, appRequest } from './auth-test-kit';
import type { User } from '@/domain/repository';

const REFUSES_A_GOOGLE_ACCOUNT_PATTERN = /email/u;
const FAILS_CLOSED_WITHOUT_A_PATTERN = /SESSION_SECRET/u;

/** A value that is not there, for fields the test leaves out on purpose. */
// eslint-disable-next-line sonarjs/no-undefined-assignment -- a key set to undefined is what these tests send
const unset = undefined;

const tracing = installFakeTracing();

const person = fixtureUser({
  id: 4,
  email: 'ada@example.com',
  name: 'Ada',
  picture: null,
  session_epoch: 2,
});

const upsertGoogleUser = jest
  .fn<(profile: unknown) => Promise<User>>()
  .mockResolvedValue(person);
const afterSignIn = jest
  .fn<(user: unknown) => Promise<void>>()
  .mockResolvedValue();

// eslint-disable-next-line tslop/no-module-mocking -- the module reads the runtime (cookies or the Cloudflare context), which a test cannot supply, so the test replaces it before importing the code under test
jest.unstable_mockModule('@/domain/auth/store', () => ({
  upsertGoogleUser,
  // Importing core/auth via its barrel now also loads the current-user lookup,
  // which reads these; sign-in never calls them, so stubs keep the shape whole.
  getUserById: jest.fn(async () => person),
  getSessionEpoch: jest.fn(async () => 0),
}));
// eslint-disable-next-line tslop/no-module-mocking -- the module reads the runtime (cookies or the Cloudflare context), which a test cannot supply, so the test replaces it before importing the code under test
jest.unstable_mockModule('@/domain/auth/hooks', () => ({
  afterSignIn,
  OTHER_FLOWS: {},
}));

const { completeSignIn, missingSignInSettings } =
  await import('@/domain/auth/sign-in');
const { SessionTokens } = await import('@/lib/session');

const env = (overrides: Record<string, string | undefined> = {}) =>
  fixtureEnv({
    SESSION_SECRET,
    GOOGLE_OAUTH_CLIENT_ID: 'id',
    GOOGLE_OAUTH_CLIENT_SECRET: 'secret',
    ...overrides,
  });

const context = (overrides: Record<string, unknown> = {}) => ({
  request: appRequest('GET', '/auth/callback'),
  env: env(),
  origin: 'https://app.test',
  returnTo: unset,
  ...overrides,
});

beforeEach(() => {
  for (const key of Object.keys(tracing.attributes)) {
    delete tracing.attributes[key];
  }
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
          GOOGLE_OAUTH_CLIENT_ID: unset,
          GOOGLE_OAUTH_CLIENT_SECRET: '',
          SESSION_SECRET: unset,
        }),
      ),
    ).toEqual([
      'GOOGLE_OAUTH_CLIENT_ID',
      'GOOGLE_OAUTH_CLIENT_SECRET',
      'SESSION_SECRET',
    ]);
  });
});

describe('completeSignIn — error context', () => {
  it('names the person by their internal number only', async () => {
    await completeSignIn(context(), {
      sub: 'g1',
      email: 'ada@example.com',
      name: 'Ada',
    });
    expect(tracing.attributes).toEqual({ 'user.id': 4 });
  });

  it('names nobody when the sign-in fails', async () => {
    await expect(completeSignIn(context(), { sub: 'g1' })).rejects.toThrow();
    expect(tracing.attributes).toEqual({});
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
      picture: unset,
    });
    expect(afterSignIn).toHaveBeenCalledWith(person);
    expect(
      await new SessionTokens(SESSION_SECRET).verify(
        res.cookies.get(SESSION_COOKIE)?.value ?? '',
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
      REFUSES_A_GOOGLE_ACCOUNT_PATTERN,
    );
    expect(upsertGoogleUser).not.toHaveBeenCalled();
  });

  it('fails closed without a session secret, recording nobody', async () => {
    await expect(
      completeSignIn(context({ env: env({ SESSION_SECRET: unset }) }), {
        sub: 'g1',
        email: 'ada@example.com',
      }),
    ).rejects.toThrow(FAILS_CLOSED_WITHOUT_A_PATTERN);
    expect(upsertGoogleUser).not.toHaveBeenCalled();
    expect(afterSignIn).not.toHaveBeenCalled();
  });
});
