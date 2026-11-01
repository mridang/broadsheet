/**
 * Everyone's briefings, for an operator.
 *
 *   GET /api/briefings → 200
 *
 * The behaviour lives in the `briefingAudit` controller; this file only
 * mounts it.
 */

import { briefingAudit } from '@/domain/api/briefings';

export const dynamic = 'force-dynamic';

export const { GET } = briefingAudit.handlers();
