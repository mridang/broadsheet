/**
 * One of the signed-in person's saved searches.
 *
 *   DELETE /api/users/self/searches/:id → 204
 *
 * The behaviour lives in the `searchItem` controller; this file only mounts
 * it.
 */

import { searchItem } from '@/domain/api/searches';

export const dynamic = 'force-dynamic';

export const { DELETE } = searchItem.handlers();
