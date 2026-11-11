/**
 * Questions about one article, answered from its text.
 *
 * POST /api/articles/:id/answers {question} → 200.
 *
 * The behaviour lives in the `answersCollection` controller; this file only
 * mounts it.
 */

import { answersCollection } from '@/domain/api/answers';

export const dynamic = 'force-dynamic';

export const { POST } = answersCollection.handlers();
