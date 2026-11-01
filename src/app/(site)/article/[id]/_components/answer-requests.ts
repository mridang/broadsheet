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
/** The choices that go with any question: the turns it follows, the model and thinking. */
interface AskOptions {
  readonly history?: readonly AskTurn[];
  readonly model?: string;
  readonly thinking?: boolean;
}

/** What to ask: a preset by id or the reader's own question, with its options. */
export type AskInput =
  | (AskOptions & { readonly question_id: string })
  | (AskOptions & { readonly question: string });

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

/** Turn a recorded question into text (`POST /api/transcriptions`). */
export async function transcribeAudio(audio: Blob): Promise<string> {
  const res = await fetch('/api/transcriptions', {
    method: 'POST',
    headers: { 'Content-Type': audio.type || 'audio/webm' },
    body: audio,
  });
  await ensureOk(res);
  return ((await res.json()) as { text: string }).text;
}
