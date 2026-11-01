/**
 * The signed-in person's notification rules.
 *
 *   POST /api/users/self/notifications/rules {kind, value, …, channels} → 201 + Location
 *
 * The behaviour lives in the `notificationRules` controller; this file only
 * mounts it.
 */

import { notificationRules } from '@/domain/api/notifications';

export const dynamic = 'force-dynamic';

export const { POST } = notificationRules.handlers();
