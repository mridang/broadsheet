/**
 * The sources trending across the app.
 *
 *   GET /api/sources?order=&window=&cursor=&limit= → 200 {self, next?, items}.
 *
 * The behaviour lives in the `sourcesCollection` controller; this file only
 * mounts it.
 */

import { sourcesCollection } from '@/domain/api/sources';

export const dynamic = 'force-dynamic';

export const { GET } = sourcesCollection.handlers();
