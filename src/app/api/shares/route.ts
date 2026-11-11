/**
 * The stories people shared.
 *
 *   GET /api/shares?user_id&limit&cursor → 200 {self, next?, items}.
 *
 * The behaviour lives in the `sharesCollection` controller; this file only
 * mounts it.
 */

import { sharesCollection } from '@/domain/api/shares';

export const dynamic = 'force-dynamic';

export const { GET } = sharesCollection.handlers();
