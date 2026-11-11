/**
 * The story lists the signed-in person pins to their front page.
 *
 *   GET  /api/users/self/rivers                              → 200
 *   POST /api/users/self/rivers {river_id, side, position}   → 201 + Location
 *   PUT  /api/users/self/rivers {items}                      → 200.
 *
 * The behaviour lives in the `riversCollection` controller; this file only
 * mounts it.
 */

import { riversCollection } from '@/domain/api/rivers';

export const dynamic = 'force-dynamic';

export const { GET, POST, PUT } = riversCollection.handlers();
