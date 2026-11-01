/**
 * Sources like one of the person's feeds.
 *
 *   GET /api/feeds/:id/similar → 200 page
 *
 * The behaviour lives in the `similarFeeds` controller; this file only mounts it.
 */

import { similarFeeds } from '@/domain/api/suggestions';

export const dynamic = 'force-dynamic';

export const { GET } = similarFeeds.handlers();
