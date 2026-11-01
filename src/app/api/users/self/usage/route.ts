/**
 * Today's Ask AI and assistant budgets.
 *
 *   GET /api/users/self/usage → 200
 *
 * The behaviour lives in the `usageItem` controller; this file only mounts it.
 */

import { usageItem } from '@/domain/api/usage';

export const dynamic = 'force-dynamic';

export const { GET } = usageItem.handlers();
