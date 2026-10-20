import { describe, expect, it } from '@jest/globals';

import { BRAND_URL, SITEMAP_PAGES } from '../../src/app/_brand';
import sitemap from '../../src/app/sitemap';

describe('sitemap', () => {
  const entries = sitemap();

  it('lists the pages the app names, by full address', () => {
    expect(entries.map((e) => e.url)).toEqual(
      SITEMAP_PAGES.map((page) => `${BRAND_URL}${page.path}`),
    );
  });

  it('dates a page by the day its text last changed, and gives the others no made-up date', () => {
    expect(entries.map((e) => e.lastModified)).toEqual(
      SITEMAP_PAGES.map((page) =>
        page.lastModified
          ? new Date(`${page.lastModified}T00:00:00Z`)
          : undefined,
      ),
    );
  });

  it('does not send the hints search engines ignore', () => {
    for (const entry of entries) {
      expect(entry.changeFrequency).toBeUndefined();
      expect(entry.priority).toBeUndefined();
    }
  });
});
