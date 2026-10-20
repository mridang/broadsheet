import { describe, expect, it } from '@jest/globals';

import { SESSION_COOKIE } from '../../../src/lib/account';
import { GENERIC_CLASSES } from '../../../src/lib/http/edge-limits';
import { EDGE_LIMITS } from '../../../src/lib/http/extras';

const classOf = (pathname: string) =>
  EDGE_LIMITS.classify(new Request(`https://app.test${pathname}`));

describe('EDGE_LIMITS', () => {
  it('counts only the classes every app has', () => {
    expect(EDGE_LIMITS.classes).toBe(GENERIC_CLASSES);
  });

  it('tells a signed-in reader by the session cookie', () => {
    expect(EDGE_LIMITS.sessionCookie).toBe(SESSION_COOKIE);
  });

  it.each([
    ['/', 'site'],
    ['/feeds', 'site'],
    ['/api/img', 'cover'],
    ['/api/csp-reports', 'reports'],
    ['/api/health', 'discovery'],
    ['/robots.txt', 'discovery'],
    ['/api/feeds', 'api'],
  ])('puts %s in %s', (pathname, expected) => {
    expect(classOf(pathname)).toBe(expected);
  });

  it('does not count the static files', () => {
    expect(classOf('/_next/static/chunks/a.js')).toBeUndefined();
    expect(classOf('/icons/icon-192.png')).toBeUndefined();
  });
});
