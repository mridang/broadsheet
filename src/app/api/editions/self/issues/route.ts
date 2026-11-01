/**
 * The signed-in person's issues of their default edition.
 *
 *   GET  /api/editions/self/issues → 200
 *   POST /api/editions/self/issues → 201
 *
 * The behaviour lives in the `issuesCollection` controller; this file only
 * mounts it.
 */

import { issuesCollection } from '@/domain/api/issues';

export const dynamic = 'force-dynamic';

export const { GET, POST } = issuesCollection.handlers();
