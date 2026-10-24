import type { MetadataRoute } from 'next';

import { BRAND_URL, SITEMAP_PAGES } from '@/app/_brand';

/**
 * The pages worth indexing (see `SITEMAP_PAGES` in `_brand.ts`). A page has a
 * `lastmod` only when it has an honest one: the day its text last changed.
 * `changefreq` and `priority` are ignored by Google and Bing, so they are not
 * sent.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return SITEMAP_PAGES.map(({ path, lastModified }) => ({
    url: `${BRAND_URL}${path}`,
    ...(lastModified
      ? { lastModified: new Date(`${lastModified}T00:00:00Z`) }
      : {}),
  }));
}
