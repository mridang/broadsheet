/**
 * How one of the signed-in person's feeds notifies them of new stories.
 *
 *   PUT    /api/users/self/notifications/:feed_id {filter?, channels} → 201/200
 *   DELETE /api/users/self/notifications/:feed_id                     → 204
 *
 * The behaviour lives in the `notificationItem` controller; this file only
 * mounts it.
 */

import { notificationItem } from '@/domain/api/notifications';

export const dynamic = 'force-dynamic';

export const { PUT, DELETE } = notificationItem.handlers();
