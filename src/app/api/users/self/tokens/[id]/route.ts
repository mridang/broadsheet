/**
 * One of the signed-in person's feed tokens.
 *
 *   DELETE /api/users/self/tokens/:id → 204
 *
 * The behaviour lives in the `tokenItem` controller; this file only mounts it.
 */

import { tokenItem } from '@/domain/api/outbound';

export const dynamic = 'force-dynamic';

export const { DELETE } = tokenItem.handlers();
