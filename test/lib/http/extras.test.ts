import { describe, expect, it } from '@jest/globals';

import { SESSION_COOKIE } from '../../../src/lib/auth/app';
import { GENERIC_CLASSES } from '../../../src/lib/http/edge-limits';
import { EDGE_LIMITS } from '../../../src/lib/http/extras';

const classOf = (pathname: string) =>
  EDGE_LIMITS.classify(new Request(`https://app.test${pathname}`));

describe('EDGE_LIMITS', () => {
  it('counts the classes every app has, and the sign-in class', () => {
    expect(EDGE_LIMITS.classes).toEqual({
      ...GENERIC_CLASSES,
      auth: {
        binding: 'RL_AUTH',
        counted: 'address',
        periodSeconds: 60,
        style: 'text',
      },
    });
  });

  it('tells a signed-in reader by the session cookie', () => {
    expect(EDGE_LIMITS.sessionCookie).toBe(SESSION_COOKIE);
  });

  it.each([
    ['/', 'site'],
    ['/feeds', 'site'],
    ['/img', 'cover'],
    ['/csp/reports', 'reports'],
    ['/health', 'discovery'],
    ['/robots.txt', 'discovery'],
    ['/api/feeds', 'api'],
    ['/api/sessions', 'api'],
    ['/auth/login', 'auth'],
    ['/auth/callback', 'auth'],
    ['/api/sessions/self', 'auth'],
  ])('puts %s in %s', (pathname, expected) => {
    expect(classOf(pathname)).toBe(expected);
  });

  it('does not count the static files', () => {
    expect(classOf('/_next/static/chunks/a.js')).toBeUndefined();
    expect(classOf('/icons/icon-192.png')).toBeUndefined();
  });
});
