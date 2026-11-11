/**
 * One of the signed-in person's notification rules.
 *
 * DELETE /api/users/self/notifications/rules/:id → 204.
 *
 * The behaviour lives in the `notificationRuleItem` controller; this file
 * only mounts it.
 */

import { notificationRuleItem } from '@/domain/api/notifications';

export const dynamic = 'force-dynamic';

export const { DELETE } = notificationRuleItem.handlers();
