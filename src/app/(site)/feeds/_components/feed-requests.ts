/**
 * @packageDocumentation
 *
 * The browser's calls to the feeds API. Each resolves when the server did what
 * was asked and throws a `ProblemError` carrying the server's own words when it
 * refused (see `problemText`).
 */

import { ensureOk } from '@/components/api/problem-message';

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

/** Fetch every followed feed again now (`POST /api/feeds/refreshes`). */
export async function refreshFeeds(): Promise<void> {
  await ensureOk(await fetch('/api/feeds/refreshes', { method: 'POST' }));
}
