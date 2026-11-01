/**
 * How many of the signed-in person's saves came from each feed.
 *
 *   GET /api/users/self/saves/feeds → 200
 *
 * The behaviour lives in the `saveFeedsCollection` controller; this file only mounts it.
 */

import { saveFeedsCollection } from '@/domain/api/saves';

export const dynamic = 'force-dynamic';

export const { GET } = saveFeedsCollection.handlers();
