/**
 * @packageDocumentation
 *
 * The browser's call to ask about an article. Resolves with the answer and
 * throws a `ProblemError` carrying the server's own words when it refused.
 */

import { ensureOk } from '@/components/api/problem-message';

/** An earlier turn a follow-up builds on. */
export interface AskTurn {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

/** What to ask: a preset by id or the reader's own question, and the turns it follows. */
export type AskInput =
  | { readonly question_id: string; readonly history?: readonly AskTurn[] }
  | { readonly question: string; readonly history?: readonly AskTurn[] };

/** An answer, with what was asked and how many questions are left today. */
export interface AskAnswer {
  readonly question: string;
  readonly answer: string;
  readonly remaining: number;
}

/** Ask about the article with this id (`POST /api/articles/:id/answers`). */
export async function askArticle(
  id: number,
  input: AskInput,
): Promise<AskAnswer> {
  const res = await fetch(`/api/articles/${id}/answers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  await ensureOk(res);
  return (await res.json()) as AskAnswer;
}
