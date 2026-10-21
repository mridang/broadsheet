import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import { GET } from '../../../../../src/app/api/auth/login/route';
import { RETURN_COOKIE, STATE_COOKIE } from '../../../../../src/lib/auth/app';
import {
  SESSION_SECRET,
  appRequest,
  installEnv,
} from '../../../../lib/auth/auth-test-kit';

let restore: () => void;

beforeEach(() => {
  restore = installEnv();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  restore();
  jest.restoreAllMocks();
});

const locationOf = (res: Response): URL | undefined => {
  const location = res.headers.get('location');
  return location ? new URL(location) : undefined;
};

describe('GET /api/auth/login', () => {
  it('sends the browser to Google asking only who the person is', () => {
    const res = GET(appRequest('GET', '/api/auth/login'));
    const target = locationOf(res);
    expect(res.status).toBe(307);
    expect(`${target?.origin}${target?.pathname}`).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    expect(target?.searchParams.get('client_id')).toBe('client-id');
    expect(target?.searchParams.get('redirect_uri')).toBe(
      'https://app.test/api/auth/callback',
    );
    expect(target?.searchParams.get('scope')).toBe('openid email profile');
  });

  it('keeps the same one-time state in the address and in an httpOnly cookie', () => {
    const res = GET(appRequest('GET', '/api/auth/login'));
    const state = locationOf(res)?.searchParams.get('state');
    expect(state).toMatch(/^signin\./);
    expect(res.cookies.get(STATE_COOKIE)).toMatchObject({
      value: state,
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      maxAge: 600,
    });
  });

  it('gives each visit a different state', () => {
    const state = () =>
      locationOf(GET(appRequest('GET', '/api/auth/login')))?.searchParams.get(
        'state',
      );
    expect(state()).not.toBe(state());
  });

  it('remembers a safe returnTo in a cookie', () => {
    const res = GET(appRequest('GET', '/api/auth/login?returnTo=%2Fa%2Fb'));
    expect(res.cookies.get(RETURN_COOKIE)?.value).toBe('/a/b');
  });

  it.each([
    'https://evil.example/',
    '//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
    '/a\r\nb',
  ])('refuses to remember the returnTo %s', (target) => {
    const res = GET(
      appRequest(
        'GET',
        `/api/auth/login?returnTo=${encodeURIComponent(target)}`,
      ),
    );
    expect(res.cookies.get(RETURN_COOKIE)?.value ?? '').toBe('');
  });

  it('uses the address from APP_URL when one is configured', () => {
    restore();
    restore = installEnv({
      SESSION_SECRET,
      GOOGLE_OAUTH_CLIENT_ID: 'client-id',
      GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret',
      APP_URL: 'https://the.site',
    });
    const target = locationOf(GET(appRequest('GET', '/api/auth/login')));
    expect(target?.searchParams.get('redirect_uri')).toBe(
      'https://the.site/api/auth/callback',
    );
  });
});

describe('GET /api/auth/login on a server that is not set up', () => {
  it.each([
    [
      'SESSION_SECRET',
      { GOOGLE_OAUTH_CLIENT_ID: 'a', GOOGLE_OAUTH_CLIENT_SECRET: 'b' },
    ],
    [
      'GOOGLE_OAUTH_CLIENT_ID',
      { SESSION_SECRET, GOOGLE_OAUTH_CLIENT_SECRET: 'b' },
    ],
    [
      'GOOGLE_OAUTH_CLIENT_SECRET',
      { SESSION_SECRET, GOOGLE_OAUTH_CLIENT_ID: 'a' },
    ],
  ])('refuses and names %s when it is missing', async (name, env) => {
    restore();
    restore = installEnv(env);
    const res = GET(appRequest('GET', '/api/auth/login'));
    expect(res.status).toBe(503);
    expect(res.headers.get('location')).toBeNull();
    expect(await res.text()).toContain(name);
    expect(res.cookies.getAll()).toEqual([]);
  });

  it('refuses without a session secret, never signing with a made-up one', () => {
    restore();
    restore = installEnv({
      SESSION_SECRET: '',
      GOOGLE_OAUTH_CLIENT_ID: 'a',
      GOOGLE_OAUTH_CLIENT_SECRET: 'b',
    });
    const res = GET(appRequest('GET', '/api/auth/login'));
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });

  it('names every missing setting, and never a value', async () => {
    restore();
    restore = installEnv({ GOOGLE_OAUTH_CLIENT_ID: 'visible-id-value' });
    const text = await GET(appRequest('GET', '/api/auth/login')).text();
    expect(text).toContain('GOOGLE_OAUTH_CLIENT_SECRET, SESSION_SECRET');
    expect(text).not.toContain('visible-id-value');
  });
});
