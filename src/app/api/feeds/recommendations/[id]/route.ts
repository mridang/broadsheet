/**
 * A curator's decision on a recommended feed.
 *
 *   PATCH /api/feeds/recommendations/:id {status} → 200.
 *
 * The behaviour lives in the `recommendationItem` controller; this file only mounts it.
 */

import { recommendationItem } from '@/domain/api/discover';

export const dynamic = 'force-dynamic';

export const { PATCH } = recommendationItem.handlers();
