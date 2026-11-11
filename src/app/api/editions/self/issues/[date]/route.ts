/**
 * One day's issue of the signed-in person's default edition.
 *
 * GET /api/editions/self/issues/:date → 200.
 *
 * The behaviour lives in the `issueItem` controller; this file only mounts
 * it.
 */

import { issueItem } from '@/domain/api/issues';

export const dynamic = 'force-dynamic';

export const { GET } = issueItem.handlers();
