/**
 * Conversations with the archive assistant.
 *
 *   GET /api/conversations?limit&cursor → 200 page
 *   POST /api/conversations → 201
 *
 * The behaviour lives in the `conversationsCollection` controller; this file
 * only mounts it.
 */

import { conversationsCollection } from '@/domain/api/conversations';

export const dynamic = 'force-dynamic';

export const { GET, POST } = conversationsCollection.handlers();
