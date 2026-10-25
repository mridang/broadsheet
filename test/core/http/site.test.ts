import { describe, expect, it } from '@jest/globals';

import {
  CACHED_QUERY_PARAMS,
  EDGE_CACHED_PAGES,
  EDGE_TTL_SECONDS,
  EXTRA_DIRECTIVES,
  EXTRA_IMG_SOURCES,
  OPEN_FILES,
  PUBLIC_PAGES,
  RARELY_CHANGING,
} from '@/core/http';

describe('site settings', () => {
  it('lets the edge keep the same pages that may be indexed', () => {
    expect([...EDGE_CACHED_PAGES]).toEqual([...PUBLIC_PAGES]);
  });

  it('lets a kept page carry no query string', () => {
    expect([...CACHED_QUERY_PARAMS]).toEqual([]);
  });

  it('keeps a copy for five minutes', () => {
    expect(EDGE_TTL_SECONDS).toBe(300);
  });

  it('lets search engines index only the front page', () => {
    expect([...PUBLIC_PAGES]).toEqual(['/']);
  });

  it('opens the cards, the icons, the manifest and the root text files to other sites', () => {
    for (const path of [
      '/opengraph-image.png',
      '/twitter-image.png',
      '/icon.svg',
      '/apple-icon.png',
      '/favicon.ico',
      '/manifest.webmanifest',
      '/robots.txt',
      '/sitemap.xml',
      '/llms.txt',
      '/security-policy.txt',
      '/icons/icon-192.png',
      '/.well-known/security.txt',
    ]) {
      expect(OPEN_FILES.test(path)).toBe(true);
    }
    for (const path of ['/', '/feeds', '/api/img', '/api/feeds']) {
      expect(OPEN_FILES.test(path)).toBe(false);
    }
  });

  it('adds no outside picture sources: every picture comes through this site', () => {
    expect(EXTRA_IMG_SOURCES).toEqual([]);
  });

  it('lets the social cards, the icons and the manifest be cached for a day', () => {
    for (const path of RARELY_CHANGING) {
      expect(OPEN_FILES.test(path)).toBe(true);
    }
    expect([...RARELY_CHANGING].sort()).toEqual([
      '/apple-icon.png',
      '/favicon.ico',
      '/icon.svg',
      '/manifest.webmanifest',
      '/opengraph-image.png',
      '/twitter-image.png',
    ]);
  });

  it('adds no directives of its own', () => {
    expect(EXTRA_DIRECTIVES).toEqual([]);
  });
});
