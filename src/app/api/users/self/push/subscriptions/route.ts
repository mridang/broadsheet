/**
 * The signed-in person's push subscriptions.
 *
 * POST /api/users/self/push/subscriptions {endpoint, keys} → 201 + Location.
 *
 * The behaviour lives in the `pushSubscriptionsCollection` controller; this file only mounts it.
 */

import { pushSubscriptionsCollection } from '@/domain/api/outbound';

export const dynamic = 'force-dynamic';

export const { POST } = pushSubscriptionsCollection.handlers();
