/**
 * @packageDocumentation
 *
 * The browser's calls to the archive assistant. Each throws a `ProblemError`
 * carrying the server's own words when it refused.
 */

import { ensureOk } from '@/components/api/problem-message';

/** An article an answer drew on. */
export interface Citation {
  readonly article_id: string;
  readonly title?: string;
  readonly href: string;
}

/** A turn of a conversation. */
export interface Turn {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly citations: readonly Citation[];
}

/** Start a conversation (`POST /api/conversations`); its id. */
export async function startConversation(): Promise<string> {
  const res = await fetch('/api/conversations', { method: 'POST' });
  await ensureOk(res);
  return ((await res.json()) as { id: string }).id;
}

/** Ask a question in a conversation (`POST /api/conversations/:id/messages`); the answer. */
export async function sendMessage(
  conversationId: string,
  content: string,
): Promise<Turn> {
  const res = await fetch(`/api/conversations/${conversationId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  await ensureOk(res);
  return (await res.json()) as Turn;
}

/** Remove a conversation (`DELETE /api/conversations/:id`). */
export async function deleteConversation(id: string): Promise<void> {
  await ensureOk(await fetch(`/api/conversations/${id}`, { method: 'DELETE' }));
}
