/**
 * Feeds put forward for everyone.
 *
 *   GET /api/feeds/recommendations?status → 200 page
 *   POST /api/feeds/recommendations {url, title?, description} → 201.
 *
 * The behaviour lives in the `recommendationsCollection` controller; this file only mounts it.
 */

import { recommendationsCollection } from '@/domain/api/discover';

export const dynamic = 'force-dynamic';

export const { GET, POST } = recommendationsCollection.handlers();
