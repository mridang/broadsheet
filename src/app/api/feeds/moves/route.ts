/**
 * Moves of several of the signed-in person's feeds into one section.
 *
 * POST /api/feeds/moves {feed_ids, section_id} → 200 {moved}.
 *
 * A move is not stored, so the result is the response. The behaviour lives in
 * the `feedMoves` controller; this file only mounts it.
 */

import { feedMoves } from '@/domain/api/feeds';

export const dynamic = 'force-dynamic';

export const { POST } = feedMoves.handlers();
