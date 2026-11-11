/**
 * One of the signed-in person's push subscriptions.
 *
 * DELETE /api/users/self/push/subscriptions/:id → 204.
 *
 * The behaviour lives in the `pushSubscriptionItem` controller; this file only mounts it.
 */

import { pushSubscriptionItem } from '@/domain/api/outbound';

export const dynamic = 'force-dynamic';

export const { DELETE } = pushSubscriptionItem.handlers();
