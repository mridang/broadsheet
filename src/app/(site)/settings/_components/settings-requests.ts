/**
 * @packageDocumentation
 *
 * The browser's calls behind the settings page. Each resolves when the server
 * did what was asked and throws a `ProblemError` carrying the server's own
 * words when it refused.
 */

import { ensureOk } from '@/components/api/problem-message';

/** Post `body` as JSON to `path` and read the JSON answer. */
async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  await ensureOk(res);
  return (await res.json()) as T;
}

/** Add a webhook (`POST /api/users/self/webhooks`); its secret, shown once. */
export async function addWebhook(
  url: string,
  events: readonly string[],
): Promise<string> {
  const hook = await postJson<{ secret: string }>('/api/users/self/webhooks', {
    url,
    events,
  });
  return hook.secret;
}

/** Remove a webhook (`DELETE /api/users/self/webhooks/:id`). */
export async function removeWebhook(id: number): Promise<void> {
  await ensureOk(
    await fetch(`/api/users/self/webhooks/${id}`, { method: 'DELETE' }),
  );
}

/** What a new feed token shows. */
export interface TokenRequest {
  readonly scope: string;
  readonly tag?: string;
  readonly section_id?: string;
}

/** Make a feed token (`POST /api/users/self/tokens`); its feed address, shown once. */
export async function addToken(request: TokenRequest): Promise<string> {
  const token = await postJson<{ feed_url: string }>(
    '/api/users/self/tokens',
    request,
  );
  return token.feed_url;
}

/** Revoke a feed token (`DELETE /api/users/self/tokens/:id`). */
export async function revokeToken(id: number): Promise<void> {
  await ensureOk(
    await fetch(`/api/users/self/tokens/${id}`, { method: 'DELETE' }),
  );
}
