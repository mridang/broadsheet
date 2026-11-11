/**
 * The stories the signed-in person saved.
 *
 *   GET /api/users/self/saves?tag&limit&cursor → 200 page.
 *
 * The behaviour lives in the `savesCollection` controller; this file only
 * mounts it.
 */

import { savesCollection } from '@/domain/api/saves';

export const dynamic = 'force-dynamic';

export const { GET } = savesCollection.handlers();
