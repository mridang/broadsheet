/**
 * The tags on the signed-in person's saves, with their counts.
 *
 *   GET /api/users/self/saves/tags → 200
 *
 * The behaviour lives in the `saveTagsCollection` controller; this file only mounts it.
 */

import { saveTagsCollection } from '@/domain/api/saves';

export const dynamic = 'force-dynamic';

export const { GET } = saveTagsCollection.handlers();
