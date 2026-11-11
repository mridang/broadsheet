/**
 * One article from the feeds the signed-in person follows, with its text.
 *
 * GET /api/articles/:id → 200.
 *
 * The behaviour lives in the `articleItem` controller; this file only mounts
 * it.
 */

import { articleItem } from '@/domain/api/articles';

export const dynamic = 'force-dynamic';

export const { GET } = articleItem.handlers();
