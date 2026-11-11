/**
 * Removals of several of the signed-in person's feeds at once.
 *
 * POST /api/feeds/removals {feed_ids} → 200 {removed}.
 *
 * A removal is not stored, so the result is the response. The behaviour lives
 * in the `feedRemovals` controller; this file only mounts it.
 */

import { feedRemovals } from '@/domain/api/feeds';

export const dynamic = 'force-dynamic';

export const { POST } = feedRemovals.handlers();
