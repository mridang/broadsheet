/**
 * The topics a new reader can pick starter feeds from.
 *
 *   GET /api/topics → 200 {self, items}
 *
 * The behaviour lives in the `topicsCollection` controller; this file only
 * mounts it.
 */

import { topicsCollection } from '@/domain/api/topics';

export const dynamic = 'force-dynamic';

export const { GET } = topicsCollection.handlers();
