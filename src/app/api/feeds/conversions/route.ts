/**
 * The feed of a newsletter, blog or channel, or a Google News feed.
 *
 *   POST /api/feeds/conversions {url} | {google_news} → 200
 *
 * The behaviour lives in the `feedConversions` controller; this file only mounts it.
 */

import { feedConversions } from '@/domain/api/discover';

export const dynamic = 'force-dynamic';

export const { POST } = feedConversions.handlers();
