/**
 * One of the signed-in person's briefings.
 *
 *   GET /api/editions/self/briefings/:id → 200
 *
 * The behaviour lives in the `briefingItem` controller; this file only mounts
 * it.
 */

import { briefingItem } from '@/domain/api/briefings';

export const dynamic = 'force-dynamic';

export const { GET } = briefingItem.handlers();
