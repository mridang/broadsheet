import { describe, expect, it } from '@jest/globals';
import { z } from 'zod';

import { BRAND_URL, CRAWLABLE_PATHS, PRIVATE_PATHS } from '@/app/_brand';
import robots from '@/app/robots';

/** Matches trailing dollar. */
const TRAILING_DOLLAR = /\$$/u;

const GROUPS = z.array(
  z.object({
    userAgent: z.string(),
    allow: z.array(z.string()),
    disallow: z.array(z.string()),
  }),
);

describe('robots.txt', () => {
  const groups = GROUPS.parse(robots().rules);
  const rule = groups[0]!;

  /**
   * Whether the `*` group lets a crawler fetch `target` (path plus query),
   * decided the way RFC 9309 section 2.2.2 says: the longest matching rule
   * wins, `Allow` wins a tie, `$` anchors the end and `*` matches anything.
   */
  const allowed = (target: string): boolean => {
    const escaped = String.raw`\$&`;
    const matches = (pattern: string): boolean =>
      new RegExp(
        `^${pattern.replaceAll(/[.+?^{}()|[\]\\]/gu, escaped).replaceAll('*', '.*')}`,
        'u',
      ).test(target);
    const hit = (patterns: string[]): number =>
      Math.max(-1, ...patterns.flatMap((p) => (matches(p) ? [p.length] : [])));
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
      expect(allowed(path.replace(TRAILING_DOLLAR, ''))).toBe(true);
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
