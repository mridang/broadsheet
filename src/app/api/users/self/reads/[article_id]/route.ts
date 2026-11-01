/**
 * The signed-in person having opened one story, or marking it unread.
 *
 *   POST   /api/users/self/reads/:article_id → 201 + Location
 *   DELETE /api/users/self/reads/:article_id → 204
 *
 * The behaviour lives in the `readItem` controller; this file only mounts
 * it.
 */

import { readItem } from '@/domain/api/reads';

export const dynamic = 'force-dynamic';

export const { POST, DELETE } = readItem.handlers();
