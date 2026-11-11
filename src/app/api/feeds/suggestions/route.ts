/**
 * Sources other readers follow alongside the caller's own.
 *
 *   GET /api/feeds/suggestions → 200 page.
 *
 * The behaviour lives in the `suggestionsCollection` controller; this file
 * only mounts it.
 */

import { suggestionsCollection } from '@/domain/api/suggestions';

export const dynamic = 'force-dynamic';

export const { GET } = suggestionsCollection.handlers();
