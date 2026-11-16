import { describe, expect, it } from '@jest/globals';

import { SESSION_COOKIE } from '@/domain/auth/app';
import { GENERIC_CLASSES, EDGE_LIMITS } from '@/lib/core/http';

const cssOf = (pathname: string) =>
  EDGE_LIMITS.classify(new Request(`https://app.test${pathname}`));

describe('EDGE_LIMITS', () => {
  it('counts the classes every app has, the sign-in class and the model class', () => {
    expect(EDGE_LIMITS.classes).toEqual({
      ...GENERIC_CLASSES,
      auth: {
        binding: 'RL_AUTH',
        counted: 'address',
        periodSeconds: 60,
        style: 'text',
      },
      ai: {
        binding: 'RL_AI',
        counted: 'person',
        periodSeconds: 60,
        style: 'problem',
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
    expect(cssOf(pathname)).toBe(expected);
  });

  it.each([
    '/api/articles/4/answers',
    '/events/articles/4/answers',
    '/api/conversations/2/messages',
  ])('puts a POST to %s in ai', (pathname) => {
    expect(
      EDGE_LIMITS.classify(
        new Request(`https://app.test${pathname}`, { method: 'POST' }),
      ),
    ).toBe('ai');
  });

  it.each(['/api/conversations/2', '/api/conversations/2/messages'])(
    'puts a GET of %s in api',
    (pathname) => {
      expect(cssOf(pathname)).toBe('api');
    },
  );

  it('does not count the static files', () => {
    expect(cssOf('/_next/static/chunks/a.js')).toBeUndefined();
    expect(cssOf('/icons/icon-192.png')).toBeUndefined();
  });
});
