import { describe, expect, it } from '@jest/globals';

import {
  EXTRA_DIRECTIVES,
  EXTRA_IMG_SOURCES,
  OPEN_FILES,
  PUBLIC_PAGES,
  RARELY_CHANGING,
} from '../../../src/lib/http/site';

describe('site settings', () => {
  it('lets search engines index only the front page', () => {
    expect([...PUBLIC_PAGES]).toEqual(['/']);
  });

  it('opens the icons, the manifest and the root text files to other sites', () => {
    for (const path of [
      '/favicon.ico',
      '/icon.svg',
      '/manifest.webmanifest',
      '/robots.txt',
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

  it('lets the icons and the manifest be cached for a day', () => {
    for (const path of RARELY_CHANGING) {
      expect(OPEN_FILES.test(path)).toBe(true);
    }
    expect([...RARELY_CHANGING].sort()).toEqual([
      '/favicon.ico',
      '/icon.svg',
      '/manifest.webmanifest',
    ]);
  });

  it('adds no directives of its own', () => {
    expect(EXTRA_DIRECTIVES).toEqual([]);
  });
});
