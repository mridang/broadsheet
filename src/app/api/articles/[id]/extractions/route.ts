/**
 * Fetching an article's text again from its page.
 *
 * POST /api/articles/:id/extractions → 200.
 *
 * The behaviour lives in the `articleExtractions` controller; this file only
 * mounts it.
 */

import { articleExtractions } from '@/domain/api/articles';

export const dynamic = 'force-dynamic';

export const { POST } = articleExtractions.handlers();
