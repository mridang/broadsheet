/**
 * Starter questions for the archive assistant.
 *
 *   GET /api/conversations/suggestions → 200 page
 *
 * The behaviour lives in the `conversationSuggestions` controller; this file only mounts it.
 */

import { conversationSuggestions } from '@/domain/api/conversations';

export const dynamic = 'force-dynamic';

export const { GET } = conversationSuggestions.handlers();
