import { describe, expect, it } from '@jest/globals';

import {
  EXTRA_IMG_SOURCES,
  OPEN_FILES,
  PUBLIC_PAGES,
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
    for (const path of ['/', '/feeds', '/img', '/api/feeds']) {
      expect(OPEN_FILES.test(path)).toBe(false);
    }
  });

  it('names only the favicon service and its image host as outside picture sources', () => {
    expect(EXTRA_IMG_SOURCES).toEqual([
      'https://www.google.com',
      'https://*.gstatic.com',
    ]);
  });
});
