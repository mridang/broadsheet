/**
 * Many stories read at once.
 *
 *   POST /api/users/self/reads → 200 { items }
 *
 * The behaviour lives in the `readsCollection` controller; this file only
 * mounts it.
 */

import { readsCollection } from '@/domain/api/reads';

export const dynamic = 'force-dynamic';

export const { POST } = readsCollection.handlers();
