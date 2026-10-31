import { describe, expect, it } from '@jest/globals';

import {
  BRAND_NAME,
  BRAND_SHORT_NAME,
  BRAND_URL,
  CRAWLABLE_PATHS,
  MANIFEST_EXTRAS,
  PRIVATE_PATHS,
  SITEMAP_PAGES,
  THEME_COLOR,
} from '@/app/_brand';

describe('the brand', () => {
  it('is named and placed as the site says', () => {
    expect(BRAND_NAME).toBe('The Hacker Times');
    expect(BRAND_SHORT_NAME).toBe('Hacker Times');
    expect(BRAND_URL).toBe('https://broadsheet.apps.mrida.ng');
  });

  it('has a short name that fits under a home-screen icon', () => {
    expect(BRAND_SHORT_NAME.length).toBeLessThanOrEqual(12);
  });

  it('colours the browser bar the crimson of the default theme', () => {
    expect(THEME_COLOR).toBe('#990F3D');
  });
});

describe('what crawlers may read', () => {
  it('is the front page and the legal pages', () => {
    expect(CRAWLABLE_PATHS).toEqual(['/$', '/privacy', '/terms']);
    expect(SITEMAP_PAGES).toEqual([
      { path: '/' },
      { path: '/privacy', lastModified: '2026-11-01' },
      { path: '/terms', lastModified: '2026-11-01' },
    ]);
  });

  it('keeps them out of the feed manager, the sign-in flow and the API', () => {
    expect(PRIVATE_PATHS).toEqual(['/feeds', '/login', '/api/', '/auth/']);
  });
});

describe('what the installed app offers', () => {
  it('has no screenshots, share target or shortcuts', () => {
    expect(MANIFEST_EXTRAS).toEqual({});
  });
});
