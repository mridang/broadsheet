import { describe, expect, it } from '@jest/globals';

import {
  BRAND_URL,
  CRAWLABLE_PATHS,
  PRIVATE_PATHS,
} from '../../src/app/_brand';
import robots from '../../src/app/robots';

type Group = { userAgent: string; allow: string[]; disallow: string[] };

describe('robots.txt', () => {
  const groups = robots().rules as Group[];
  const rule = groups[0]!;

  /**
   * Whether the `*` group lets a crawler fetch `target` (path plus query),
   * decided the way RFC 9309 section 2.2.2 says: the longest matching rule
   * wins, `Allow` wins a tie, `$` anchors the end and `*` matches anything.
   */
  const allowed = (target: string): boolean => {
    const matches = (pattern: string): boolean =>
      new RegExp(
        `^${pattern.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}`,
      ).test(target);
    const hit = (patterns: string[]): number =>
      Math.max(-1, ...patterns.filter(matches).map((p) => p.length));
    return hit(rule.allow) >= hit(rule.disallow);
  };

  it('has one group, for every crawler', () => {
    expect(groups).toHaveLength(1);
    expect(rule.userAgent).toBe('*');
  });

  it('lets crawlers read the public pages the app names, and asks them to stay out of the private ones', () => {
    expect(rule.allow).toEqual([...CRAWLABLE_PATHS]);
    expect(rule.disallow).toEqual([...PRIVATE_PATHS]);
  });

  it('lets crawlers read each public page', () => {
    for (const path of CRAWLABLE_PATHS) {
      expect(allowed(path.replace(/\$$/, ''))).toBe(true);
    }
  });

  // A bare `Disallow: /app` is a prefix rule and once hid /apple-icon.png too.
  it.each([
    '/apple-icon.png',
    '/icon.svg',
    '/favicon.ico',
    '/icons/icon-192.png',
    '/icons/icon-monochrome-512.png',
    '/opengraph-image.png',
    '/twitter-image.png',
    '/manifest.webmanifest',
    '/llms.txt',
    '/sitemap.xml',
    '/security-policy.txt',
    '/sw.js',
    '/.well-known/security.txt',
  ])('does not block the public file %s', (target) => {
    expect(allowed(target)).toBe(true);
  });

  it('points crawlers at the sitemap', () => {
    expect(robots().sitemap).toBe(`${BRAND_URL}/sitemap.xml`);
  });

  it('leaves out the Yandex-only Host line', () => {
    expect(robots().host).toBeUndefined();
  });
});
