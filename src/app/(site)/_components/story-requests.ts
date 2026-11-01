/**
 * @packageDocumentation
 *
 * The browser's calls about one story: training the paper on its source,
 * saving it and noting it as read. Each resolves when the server did what was
 * asked and throws a `ProblemError` with the server's words when it refused.
 */

import { ensureOk } from '@/components/api/problem-message';

/** What a story can be trained on. */
export type TrainKind =
  'source' | 'feed' | 'author' | 'tag' | 'title' | 'text' | 'url' | 'prompt';

/** How a classifier scores what it matches. */
export type TrainScore = 'like' | 'dislike' | 'super_dislike';

/**
 * Like, dislike or super-dislike every story matching `kind` and `value`, a
 * regular expression with `isRegex` (`POST .../classifiers`).
 */
export async function train(
  kind: TrainKind,
  value: string,
  score: TrainScore,
  isRegex = false,
): Promise<void> {
  await ensureOk(
    await fetch('/api/users/self/classifiers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind,
        value,
        score,
        ...(isRegex ? { is_regex: true } : {}),
      }),
    }),
  );
}

/** Mark every unread story of one feed read (`POST .../reads`). */
export async function markFeedRead(feedId: number): Promise<void> {
  await ensureOk(
    await fetch('/api/users/self/reads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feed_ids: [String(feedId)] }),
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

/**
 * Note many stories read at once (`POST .../reads`); a failure is not
 * reported.
 */
export function markManyRead(articleIds: readonly number[]): void {
  if (!articleIds.length) return;
  void fetch('/api/users/self/reads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ article_ids: articleIds.map(String) }),
    keepalive: true,
  }).catch(() => undefined);
}

/**
 * Note how long the reader spent on a story they read (`PATCH
 * /api/users/self/reads/:article_id`). Fire-and-forget, like
 * {@link markRead}, and sent even as the page unloads.
 */
export function recordReadTime(articleId: number, seconds: number): void {
  void fetch(`/api/users/self/reads/${articleId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seconds }),
    keepalive: true,
  }).catch(() => undefined);
}

/**
 * Share the story with a comment, or stop sharing it
 * (`POST`/`DELETE .../shares/:id`).
 */
export async function setShared(
  articleId: number,
  shared: boolean,
  comments = '',
): Promise<void> {
  await ensureOk(
    await fetch(`/api/users/self/shares/${articleId}`, {
      method: shared ? 'POST' : 'DELETE',
      ...(shared
        ? {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ comments: comments.trim() || null }),
          }
        : {}),
    }),
  );
}
