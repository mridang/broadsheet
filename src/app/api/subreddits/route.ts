/**
 * Subreddits found by Reddit's search, or its popular ones.
 *
 *   GET /api/subreddits?q&limit → 200 page
 *
 * The behaviour lives in the `subredditsCollection` controller; this file only mounts it.
 */

import { subredditsCollection } from '@/domain/api/discover';

export const dynamic = 'force-dynamic';

export const { GET } = subredditsCollection.handlers();
