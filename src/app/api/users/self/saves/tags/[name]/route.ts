/**
 * One tag on the signed-in person's saves.
 *
 *   PATCH  /api/users/self/saves/tags/:name {name} → 200
 *   DELETE /api/users/self/saves/tags/:name        → 204.
 *
 * The behaviour lives in the `saveTagItem` controller; this file only mounts it.
 */

import { saveTagItem } from '@/domain/api/saves';

export const dynamic = 'force-dynamic';

export const { PATCH, DELETE } = saveTagItem.handlers();
