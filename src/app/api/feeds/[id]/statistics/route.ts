/**
 * How one feed's source is doing.
 *
 *   GET /api/feeds/:id/statistics → 200 {last_fetched_at, last_error,
 *                                   fail_count, stories_per_day}.
 *
 * The behaviour lives in the `feedStatistics` controller; this file only
 * mounts it.
 */

import { feedStatistics } from '@/domain/api/feeds';

export const dynamic = 'force-dynamic';

export const { GET } = feedStatistics.handlers();
