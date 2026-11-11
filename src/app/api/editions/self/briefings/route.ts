/**
 * The signed-in person's briefings.
 *
 * GET  /api/editions/self/briefings → 200
 *   POST /api/editions/self/briefings → 201.
 *
 * The behaviour lives in the `briefingsCollection` controller; this file only
 * mounts it.
 */

import { briefingsCollection } from '@/domain/api/briefings';

export const dynamic = 'force-dynamic';

export const { GET, POST } = briefingsCollection.handlers();
