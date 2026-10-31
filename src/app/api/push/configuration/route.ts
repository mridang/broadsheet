/**
 * The Web Push configuration.
 *
 *   GET /api/push/configuration → 200 {vapid_public_key}
 *
 * The behaviour lives in the `pushConfiguration` controller; this file only mounts it.
 */

import { pushConfiguration } from '@/domain/api/outbound';

export const dynamic = 'force-dynamic';

export const { GET } = pushConfiguration.handlers();
