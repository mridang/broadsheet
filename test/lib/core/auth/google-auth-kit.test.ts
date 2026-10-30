import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { NextResponse } from 'next/server';

import { STATE_COOKIE } from '@/domain/auth/app';
import type { User } from '@/domain/auth/store';
import {
  answerFetch,
  appRequest,
  installEnv,
  jar,
} from '../../../domain/auth/auth-test-kit';
import { installFakeTracing } from '../observability/fake-tracing';

const tracing = installFakeTracing();

const person = { id: 7, email: 'a@b.com' } as User;
const getCurrentUser = jest.fn<() => Promise<User | null>>();

// Mock the specific module and import the kit from its own file: mocking the
// package barrel would replace GoogleAuthKit too.
jest.unstable_mockModule('@/lib/core/auth/current-user', () => ({
  getCurrentUser,
}));

const { GoogleAuthKit } = await import('@/lib/core/auth/google-auth-kit');

/** A kit whose config is irrelevant to the current-user lookup. */
const kit = new GoogleAuthKit({
  scopes: ['openid'],
  stateCookie: 's',
  returnCookie: 'r',
  signInFailedPath: '/login?error=auth',
  signInPurpose: 'signin',
  purposes: ['signin'],
  otherFlows: {},
  completeSignIn: async () => {
    throw new Error('not used');
  },
  missingSignInSettings: () => [],
});

describe('GoogleAuthKit.currentUser', () => {
  it('delegates to the current-user lookup', async () => {
    getCurrentUser.mockResolvedValueOnce(person);
    expect(await kit.currentUser()).toBe(person);

    getCurrentUser.mockResolvedValueOnce(null);
    expect(await kit.currentUser()).toBeNull();
  });
});

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

let missing: string[] = [];
const completeSignIn = jest.fn<() => Promise<NextResponse>>(async () =>
  NextResponse.redirect('https://app.test/app'),
);
const completeOther = jest.fn<() => Promise<NextResponse>>(async () =>
  NextResponse.redirect('https://app.test/other-done'),
);

/** A kit with one ask besides signing in, named `other`. */
const contextKit = new GoogleAuthKit({
  scopes: ['openid'],
  stateCookie: STATE_COOKIE,
  returnCookie: 'r',
  signInFailedPath: '/login?error=auth',
  signInPurpose: 'signin',
  purposes: ['signin', 'other'],
  otherFlows: {
    other: { failurePath: () => '/other-failed', complete: completeOther },
  },
  completeSignIn,
  missingSignInSettings: () => missing,
});

/** How Google answers the two calls a round trip makes. */
const google = {
  token: 'ok' as 'ok' | 'fails',
  userinfo: 'ok' as 'ok' | 'fails',
};

let restore: () => void;

beforeEach(() => {
  restore = installEnv();
  jar.clear();
  missing = [];
  google.token = 'ok';
  google.userinfo = 'ok';
  completeSignIn.mockClear();
  completeOther.mockClear();
  for (const key of Object.keys(tracing.attributes)) {
    delete tracing.attributes[key];
  }
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  answerFetch({
    [TOKEN_URL]: () =>
      google.token === 'ok'
        ? Response.json({ access_token: 'at', expires_in: 3599 })
        : new Response('invalid_grant: SECRET-DETAIL', { status: 400 }),
    [USERINFO_URL]: () =>
      google.userinfo === 'ok'
        ? Response.json({ sub: 's', email: 'e@x.test' })
        : new Response('nope', { status: 401 }),
  });
});

afterEach(() => {
  restore();
  jest.restoreAllMocks();
});

/** Run the callback for a browser that holds `cookie`, at `query`. */
function callback(query: string, cookie?: string): Promise<Response> {
  jar.clear();
  if (cookie) {
    jar.set(STATE_COOKIE, cookie);
  }
  return contextKit.callbackHandler()(
    appRequest('GET', `/auth/callback?${query}`),
  );
}

describe('the error context of the login handler', () => {
  it('names the provider, the flow and the step', async () => {
    await contextKit.loginHandler()(appRequest('GET', '/auth/login'));
    expect(tracing.attributes).toEqual({
      'auth.provider': 'google',
      'auth.flow': 'login',
      'auth.step': 'start',
    });
  });

  it('adds a fixed reason when sign-in is not set up', async () => {
    missing = ['SESSION_SECRET'];
    await contextKit.loginHandler()(appRequest('GET', '/auth/login'));
    expect(tracing.attributes['auth.failure']).toBe('not_configured');
  });
});

describe('the error context of the callback handler', () => {
  it('names a finished sign-in and carries no failure', async () => {
    await callback('code=c&state=signin.a', 'signin.a');
    expect(tracing.attributes).toEqual({
      'auth.provider': 'google',
      'auth.flow': 'callback',
      'auth.step': 'done',
    });
  });

  it('names the other ask by its purpose', async () => {
    await callback('code=c&state=other.a', 'other.a');
    expect(tracing.attributes).toMatchObject({
      'auth.flow': 'other',
      'auth.step': 'done',
    });
  });

  it('says state_mismatch when the state does not check out', async () => {
    await callback('code=c&state=signin.other', 'signin.a');
    expect(tracing.attributes).toMatchObject({
      'auth.step': 'state',
      'auth.failure': 'state_mismatch',
    });
  });

  it('says denied when Google reports an error, and no_code when it sends nothing', async () => {
    await callback('error=access_denied&state=signin.a', 'signin.a');
    expect(tracing.attributes['auth.failure']).toBe('denied');
    await callback('state=signin.a', 'signin.a');
    expect(tracing.attributes['auth.failure']).toBe('no_code');
  });

  it('says not_configured when settings are missing', async () => {
    missing = ['SESSION_SECRET'];
    await callback('code=c&state=signin.a', 'signin.a');
    expect(tracing.attributes['auth.failure']).toBe('not_configured');
  });

  it('says where the round trip failed, whatever the cause', async () => {
    google.token = 'fails';
    await callback('code=c&state=signin.a', 'signin.a');
    expect(tracing.attributes).toMatchObject({
      'auth.step': 'exchange',
      'auth.failure': 'token_exchange_failed',
    });
    google.token = 'ok';
    google.userinfo = 'fails';
    await callback('code=c&state=signin.a', 'signin.a');
    expect(tracing.attributes).toMatchObject({
      'auth.step': 'userinfo',
      'auth.failure': 'userinfo_failed',
    });
    google.userinfo = 'ok';
    completeSignIn.mockRejectedValueOnce(new Error('boom'));
    await callback('code=c&state=signin.a', 'signin.a');
    expect(tracing.attributes).toMatchObject({
      'auth.step': 'finish',
      'auth.failure': 'finish_failed',
    });
  });

  it('never puts the state, the code, a token or Google’s text in the context', async () => {
    google.token = 'fails';
    await callback('code=the-code&state=signin.a', 'signin.a');
    const everything = JSON.stringify(tracing.attributes);
    for (const secret of ['the-code', 'signin.a', 'SECRET-DETAIL', 'at']) {
      expect(everything).not.toContain(secret);
    }
  });
});
