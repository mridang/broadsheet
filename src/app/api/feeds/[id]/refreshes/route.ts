/**
 * One feed's refreshes: the way out of a broken feed.
 *
 *   POST /api/feeds/:id/refreshes → 200 {statistics} once it fetched, 502
 *                                   when it failed again
 *
 * The behaviour lives in the `feedRetries` controller; this file only mounts
 * it.
 */

import { feedRetries } from '@/domain/api/feeds';

export const dynamic = 'force-dynamic';

export const { POST } = feedRetries.handlers();
