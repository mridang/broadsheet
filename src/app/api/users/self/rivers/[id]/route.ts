/**
 * One river pinned to the signed-in person's front page.
 *
 *   DELETE /api/users/self/rivers/:id → 204
 *
 * The behaviour lives in the `riverItem` controller; this file only mounts
 * it.
 */

import { riverItem } from '@/domain/api/rivers';

export const dynamic = 'force-dynamic';

export const { DELETE } = riverItem.handlers();
