/**
 * @packageDocumentation
 *
 * The browser's calls about one story: training the paper on its source,
 * saving it and noting it as read. Each resolves when the server did what was
 * asked and throws a `ProblemError` with the server's words when it refused.
 */

import { ensureOk } from '@/components/api/problem-message';

/** Like or dislike every story from `source` (`POST .../classifiers`). */
export async function trainSource(
  source: string,
  score: 'like' | 'dislike',
): Promise<void> {
  await ensureOk(
    await fetch('/api/users/self/classifiers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'source', value: source, score }),
    }),
  );
}

/** Save the story, or stop saving it (`POST`/`DELETE .../saves/:id`). */
export async function setSaved(
  articleId: number,
  saved: boolean,
): Promise<void> {
  await ensureOk(
    await fetch(`/api/users/self/saves/${articleId}`, {
      method: saved ? 'POST' : 'DELETE',
    }),
  );
}

/**
 * Note the story as read (`POST .../reads/:id`). Sent with `keepalive` so it
 * survives the page being left for the story; a failure is not reported.
 */
export function markRead(articleId: number): void {
  void fetch(`/api/users/self/reads/${articleId}`, {
    method: 'POST',
    keepalive: true,
  }).catch(() => undefined);
}

/** Mark the story unread again (`DELETE .../reads/:id`); a failure is not reported. */
export function markUnread(articleId: number): void {
  void fetch(`/api/users/self/reads/${articleId}`, {
    method: 'DELETE',
  }).catch(() => undefined);
}
