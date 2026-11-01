/**
 * @packageDocumentation
 *
 * The browser's calls to the rivers API. Each resolves when the server did
 * what was asked and throws a `ProblemError` carrying the server's own words
 * when it refused.
 */

import { ensureOk } from '@/components/api/problem-message';

/** Pin a river at the end of a column (`POST /api/users/self/rivers`). */
export async function pinRiver(
  riverId: string,
  side: 'left' | 'right',
  position: number,
): Promise<void> {
  await ensureOk(
    await fetch('/api/users/self/rivers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ river_id: riverId, side, position }),
    }),
  );
}

/** Unpin the river with this id (`DELETE /api/users/self/rivers/:id`). */
export async function unpinRiver(id: number): Promise<void> {
  await ensureOk(
    await fetch(`/api/users/self/rivers/${id}`, { method: 'DELETE' }),
  );
}
