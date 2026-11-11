/**
 * The signed-in person's feed tokens.
 *
 * POST /api/users/self/tokens {scope, tag?, section_id?} → 201 + Location.
 *
 * The behaviour lives in the `tokensCollection` controller; this file only mounts it.
 */

import { tokensCollection } from '@/domain/api/outbound';

export const dynamic = 'force-dynamic';

export const { POST } = tokensCollection.handlers();
