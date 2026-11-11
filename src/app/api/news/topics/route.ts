/**
 * The Google News topics a feed can follow.
 *
 * GET /api/news/topics → 200 page.
 *
 * The behaviour lives in the `newsTopics` controller; this file only mounts it.
 */

import { newsTopics } from '@/domain/api/discover';

export const dynamic = 'force-dynamic';

export const { GET } = newsTopics.handlers();
