/**
 * The refreshes of the signed-in person's feeds.
 *
 *   POST /api/feeds/refreshes → 200 {feeds, refreshed, failed}
 *
 * A refresh is not stored, so there is nothing to fetch afterwards: the result
 * is in the response, which is why it answers 200 and not 201. The behaviour
 * lives in the `feedRefreshes` controller; this file only mounts it.
 */

import { feedRefreshes } from '@/domain/api/feeds';

export const dynamic = 'force-dynamic';

export const { POST } = feedRefreshes.handlers();
