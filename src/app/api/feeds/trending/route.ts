/**
 * Trending sources: popular, rising, hidden gems and new arrivals.
 *
 *   GET /api/feeds/trending?kind&days&limit → 200 page.
 *
 * The behaviour lives in the `trendingFeeds` controller; this file only mounts it.
 */

import { trendingFeeds } from '@/domain/api/discover';

export const dynamic = 'force-dynamic';

export const { GET } = trendingFeeds.handlers();
