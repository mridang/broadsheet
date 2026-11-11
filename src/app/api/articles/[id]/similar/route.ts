/**
 * The stories most like one article, from the feeds the signed-in person
 * follows.
 *
 * GET /api/articles/:id/similar → 200 {self, items}.
 *
 * The behaviour lives in the `similarArticles` controller; this file only
 * mounts it.
 */

import { similarArticles } from '@/domain/api/articles';

export const dynamic = 'force-dynamic';

export const { GET } = similarArticles.handlers();
