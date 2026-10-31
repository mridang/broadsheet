/**
 * One day's issue of one of the signed-in person's custom editions.
 *
 *   GET /api/editions/:id/issues/:date → 200
 *
 * The behaviour lives in the `editionIssueItem` controller; this file only
 * mounts it.
 */

import { editionIssueItem } from '@/domain/api/editions';

export const dynamic = 'force-dynamic';

export const { GET } = editionIssueItem.handlers();
