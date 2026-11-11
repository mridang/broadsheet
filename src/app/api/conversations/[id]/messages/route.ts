/**
 * Asking the archive assistant a question in a conversation.
 *
 *   POST /api/conversations/:id/messages {content} → 201.
 *
 * The behaviour lives in the `messagesCollection` controller; this file only
 * mounts it.
 */

import { messagesCollection } from '@/domain/api/conversations';

export const dynamic = 'force-dynamic';

export const { POST } = messagesCollection.handlers();
