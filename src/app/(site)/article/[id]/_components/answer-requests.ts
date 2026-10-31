/**
 * @packageDocumentation
 *
 * The browser's call to ask about an article. Resolves with the answer and
 * throws a `ProblemError` carrying the server's own words when it refused.
 */

import { ensureOk } from '@/components/api/problem-message';

/** Ask a question about the article with this id (`POST /api/articles/:id/answers`). */
export async function askArticle(
  id: number,
  question: string,
): Promise<string> {
  const res = await fetch(`/api/articles/${id}/answers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  });
  await ensureOk(res);
  return ((await res.json()) as { answer: string }).answer;
}
