/**
 * An answer about one article, streamed as server-sent events.
 *
 *   POST /events/articles/:id/answers {question} → 200 text/event-stream
 *
 * A stream is not a REST resource, so it lives outside `/api`; the question,
 * the budget and the sign-in are the ones of `POST /api/articles/:id/answers`.
 * The behaviour lives in the `answersStream` controller; this file only mounts it.
 */

import { answersStream } from '@/domain/api/answers';

export const dynamic = 'force-dynamic';

export const { POST } = answersStream.handlers();
