/**
 * One of the signed-in person's webhooks.
 *
 *   DELETE /api/users/self/webhooks/:id → 204.
 *
 * The behaviour lives in the `webhookItem` controller; this file only mounts it.
 */

import { webhookItem } from '@/domain/api/outbound';

export const dynamic = 'force-dynamic';

export const { DELETE } = webhookItem.handlers();
