/**
 * The signed-in person's webhooks.
 *
 *   POST /api/users/self/webhooks {url, events} → 201 + Location.
 *
 * The behaviour lives in the `webhooksCollection` controller; this file only mounts it.
 */

import { webhooksCollection } from '@/domain/api/outbound';

export const dynamic = 'force-dynamic';

export const { POST } = webhooksCollection.handlers();
