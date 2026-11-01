/**
 * @packageDocumentation
 *
 * The browser's calls to the saved-searches API. Each resolves when the
 * server did what was asked and throws a `ProblemError` carrying the server's
 * own words when it refused.
 */

import { ensureOk } from '@/components/api/problem-message';

/** Save these words, over one feed or every feed (`POST .../searches`). */
export async function saveSearch(
  query: string,
  feedId?: string,
): Promise<void> {
  await ensureOk(
    await fetch('/api/users/self/searches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        feedId === undefined ? { query } : { query, feed_id: feedId },
      ),
    }),
  );
}

/** Remove the saved search with this id (`DELETE .../searches/:id`). */
export async function removeSearch(id: number): Promise<void> {
  await ensureOk(
    await fetch(`/api/users/self/searches/${id}`, { method: 'DELETE' }),
  );
}
