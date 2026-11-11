/**
 * Spoken questions turned into text.
 *
 *   POST /api/transcriptions (audio) → 200.
 *
 * The behaviour lives in the `transcriptionsCollection` controller; this file
 * only mounts it.
 */

import { transcriptionsCollection } from '@/domain/api/transcriptions';

export const dynamic = 'force-dynamic';

export const { POST } = transcriptionsCollection.handlers();
