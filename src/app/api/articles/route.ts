/**
 * The archive of articles from the feeds the signed-in person follows.
 *
 * GET /api/articles?q=&cursor=&limit= → 200 {self, next?, items}.
 *
 * The behaviour lives in the `articlesCollection` controller; this file only
 * mounts it.
 */

import { articlesCollection } from '@/domain/api/articles';

export const dynamic = 'force-dynamic';

export const { GET } = articlesCollection.handlers();
