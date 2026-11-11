/**
 * One feed the signed-in person follows. Nothing reads it back on its own: the
 * page lists feeds on the server, so only changing and removing one is offered.
 *
 * PATCH  /api/feeds/:id {title?, muted?, section_ids?, …} → 200
 *   DELETE /api/feeds/:id                               → 204.
 *
 * The behaviour lives in the `feedItem` controller; this file only mounts it.
 */

import { feedItem } from '@/domain/api/feeds';

export const dynamic = 'force-dynamic';

export const { PATCH, DELETE } = feedItem.handlers();
