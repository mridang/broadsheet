/**
 * @packageDocumentation
 *
 * The browser's calls to the feeds API. Each resolves when the server did what
 * was asked and throws a `ProblemError` carrying the server's own words when it
 * refused (see `problemText`).
 */

import { problemError } from '@/lib/problem-message';

/** Throw the server's refusal, if the response is one. */
async function ensureOk(res: Response): Promise<void> {
  if (!res.ok) {
    throw await problemError(res);
  }
}

/** Follow the feed at `url` (`POST /api/feeds`). */
export async function followFeed(url: string): Promise<void> {
  await ensureOk(
    await fetch('/api/feeds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    }),
  );
}

/** Stop following the feed with this id (`DELETE /api/feeds/:id`). */
export async function unfollowFeed(id: number): Promise<void> {
  await ensureOk(await fetch(`/api/feeds/${id}`, { method: 'DELETE' }));
}

/** Fetch every followed feed again now (`POST /api/feed-refreshes`). */
export async function refreshFeeds(): Promise<void> {
  await ensureOk(await fetch('/api/feed-refreshes', { method: 'POST' }));
}
