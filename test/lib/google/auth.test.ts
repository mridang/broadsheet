import { afterEach, describe, expect, it, jest } from '@jest/globals';

import {
  SIGN_IN_SCOPES,
  buildAuthUrl,
  exchangeCode,
  getUserInfo,
  isAccessTokenResponse,
  postToken,
} from '@/lib/google/auth';

const base = {
  clientId: 'client-id',
  redirectUri: 'https://app.test/auth/callback',
  state: 'abc',
  scopes: SIGN_IN_SCOPES,
};

describe('buildAuthUrl', () => {
  it('asks only who the person is when signing in', () => {
    const url = new URL(buildAuthUrl(base));
    expect(url.searchParams.get('scope')).toBe('openid email profile');
  });

  it('asks for nothing else unless told to', () => {
    const url = new URL(buildAuthUrl(base));
    expect(url.searchParams.get('access_type')).toBeNull();
    expect(url.searchParams.get('prompt')).toBeNull();
    expect(url.searchParams.get('include_granted_scopes')).toBeNull();
  });

  it('adds the extra parameters an ask needs, after the scope and before the state', () => {
    const url = new URL(
      buildAuthUrl({ ...base, extra: { access_type: 'offline' } }),
    );
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect([...url.searchParams.keys()]).toEqual([
      'client_id',
      'redirect_uri',
      'response_type',
      'scope',
      'access_type',
      'state',
    ]);
  });

  it('carries the client, the callback address and the state', () => {
    const url = new URL(buildAuthUrl(base));
    expect(url.origin + url.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('redirect_uri')).toBe(base.redirectUri);
    expect(url.searchParams.get('state')).toBe('abc');
    expect(url.searchParams.get('response_type')).toBe('code');
  });
});

/** Answer the next `fetch` with a JSON body (or a failure status) and report the request. */
function answerWith(body: unknown, status = 200) {
  return jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('exchangeCode', () => {
  const params = {
    code: 'the-code',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    redirectUri: 'https://app.test/auth/callback',
  };

  it('posts the code as a form and returns the tokens', async () => {
    const tokens = {
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: 3600,
    };
    const fetchSpy = answerWith(tokens);
    await expect(exchangeCode(params)).resolves.toEqual(tokens);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(init?.method).toBe('POST');
    const form = new URLSearchParams(String(init?.body));
    expect(Object.fromEntries(form)).toEqual({
      code: 'the-code',
      client_id: 'client-id',
      client_secret: 'client-secret',
      redirect_uri: 'https://app.test/auth/callback',
      grant_type: 'authorization_code',
    });
  });

  it("throws with Google's answer when the exchange is refused", async () => {
    answerWith({ error: 'invalid_grant' }, 400);
    await expect(exchangeCode(params)).rejects.toThrow(
      /Token exchange failed: 400 .*invalid_grant/,
    );
  });

  it('throws when the answer has no access token', async () => {
    answerWith({ nothing: true });
    await expect(exchangeCode(params)).rejects.toThrow(/unexpected response/);
  });
});

describe('getUserInfo', () => {
  it('sends the access token as a bearer and returns who the person is', async () => {
    const user = { sub: '1', email: 'a@b.com', name: 'Ann' };
    const fetchSpy = answerWith(user);
    await expect(getUserInfo('at')).resolves.toEqual(user);
    expect(fetchSpy.mock.calls[0]?.[1]?.headers).toEqual({
      Authorization: 'Bearer at',
    });
  });

  it('throws when Google refuses', async () => {
    answerWith({}, 401);
    await expect(getUserInfo('at')).rejects.toThrow('userinfo failed: 401');
  });

  it('accepts an answer with only `sub`, as a grant that carries just `openid` gives', async () => {
    // Google then names the account and nothing else.
    answerWith({ sub: '1' });
    await expect(getUserInfo('at')).resolves.toEqual({ sub: '1' });
  });

  it('throws when the answer does not say which account it is', async () => {
    answerWith({ email: 'a@b.com' });
    await expect(getUserInfo('at')).rejects.toThrow(/unexpected response/);
  });

  it('throws when the email is not text', async () => {
    answerWith({ sub: '1', email: 7 });
    await expect(getUserInfo('at')).rejects.toThrow(/unexpected response/);
  });
});

describe('postToken', () => {
  it('posts the form and returns the parsed answer', async () => {
    const fetchSpy = answerWith({ ok: 1 });
    await expect(postToken({ a: 'b' }, 'Step')).resolves.toEqual({ ok: 1 });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      'https://oauth2.googleapis.com/token',
    );
  });

  it('names the step when Google refuses', async () => {
    answerWith({ error: 'nope' }, 400);
    await expect(postToken({}, 'Step')).rejects.toThrow(/Step failed: 400/);
  });
});

describe('isAccessTokenResponse', () => {
  it('wants an access token and its lifetime', () => {
    expect(isAccessTokenResponse({ access_token: 'a', expires_in: 1 })).toBe(
      true,
    );
    expect(isAccessTokenResponse({ access_token: 5, expires_in: 'soon' })).toBe(
      false,
    );
    expect(isAccessTokenResponse(null)).toBe(false);
  });
});
