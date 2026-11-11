/**
 * The signed-in person's share of one story.
 *
 *   POST   /api/users/self/shares/:article_id {comments?} → 201 + Location
 *   DELETE /api/users/self/shares/:article_id             → 204.
 *
 * The behaviour lives in the `shareItem` controller; this file only mounts
 * it.
 */

import { shareItem } from '@/domain/api/shares';

export const dynamic = 'force-dynamic';

export const { POST, DELETE } = shareItem.handlers();
