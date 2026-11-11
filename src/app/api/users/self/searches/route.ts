/**
 * The archive searches the signed-in person keeps.
 *
 *   GET  /api/users/self/searches?cursor=&limit= → 200 {self, next?, items}
 *   POST /api/users/self/searches {query, feed_id?} → 201 + Location.
 *
 * The behaviour lives in the `searchesCollection` controller; this file only
 * mounts it.
 */

import { searchesCollection } from '@/domain/api/searches';

export const dynamic = 'force-dynamic';

export const { GET, POST } = searchesCollection.handlers();
