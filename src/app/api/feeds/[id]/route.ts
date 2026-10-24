/**
 * One feed the signed-in person follows. Nothing reads it back on its own: the
 * page lists feeds on the server, so only removing one is offered.
 *
 *   DELETE /api/feeds/:id → 204
 *
 * The behaviour lives in the `feedItem` controller; this file only mounts it.
 */

import { feedItem } from '@/domain/api/feeds';

export const dynamic = 'force-dynamic';

export const { DELETE } = feedItem.handlers();
