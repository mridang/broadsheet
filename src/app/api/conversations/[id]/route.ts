/**
 * One conversation with the archive assistant, with its turns.
 *
 *   GET /api/conversations/:id → 200
 *
 * The behaviour lives in the `conversationItem` controller; this file only
 * mounts it.
 */

import { conversationItem } from '@/domain/api/conversations';

export const dynamic = 'force-dynamic';

export const { GET } = conversationItem.handlers();
