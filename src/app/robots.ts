import type { MetadataRoute } from 'next';

import { BRAND_URL, CRAWLABLE_PATHS, PRIVATE_PATHS } from './_brand';

/**
 * Crawlers may read the public pages (see `CRAWLABLE_PATHS` in `_brand.ts`);
 * everything else is private or an account endpoint, so they are asked to stay
 * out. (Every private page also says "noindex, nofollow" itself.)
 *
 * One group, for every crawler, on purpose. Search and assistant agents
 * (Googlebot, Bingbot, OAI-SearchBot, ChatGPT-User, Claude-User, PerplexityBot
 * and the like) may read the public pages, and so may the crawlers that gather
 * training data: the public pages are marketing copy and notices, and there is
 * nothing private for any of them to read. A crawler that matches a named group
 * ignores this one, so a future per-bot group has to repeat `PRIVATE_PATHS`.
 * (`Host:` is left out: only Yandex ever read it.)
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: [...CRAWLABLE_PATHS],
        disallow: [...PRIVATE_PATHS],
      },
    ],
    sitemap: `${BRAND_URL}/sitemap.xml`,
  };
}
