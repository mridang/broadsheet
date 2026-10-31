/**
 * Emailing one story.
 *
 *   POST /api/articles/:id/emails {to} → 202
 *
 * The behaviour lives in the `articleEmails` controller; this file only mounts it.
 */

import { articleEmails } from '@/domain/api/emails';

export const dynamic = 'force-dynamic';

export const { POST } = articleEmails.handlers();
