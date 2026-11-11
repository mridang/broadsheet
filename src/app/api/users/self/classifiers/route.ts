/**
 * The signed-in person's classifiers, which train the paper.
 *
 * GET  /api/users/self/classifiers?limit&cursor   → 200 page
 *   POST /api/users/self/classifiers {kind, value, score} → 201 + Location.
 *
 * The behaviour lives in the `classifiersCollection` controller; this file
 * only mounts it.
 */

import { classifiersCollection } from '@/domain/api/classifiers';

export const dynamic = 'force-dynamic';

export const { GET, POST } = classifiersCollection.handlers();
