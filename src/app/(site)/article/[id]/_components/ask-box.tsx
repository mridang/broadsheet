'use client';

import { useState, type FormEvent, type ReactElement } from 'react';

import {
  askArticle,
  type AskInput,
  type AskTurn,
} from '@/app/(site)/article/[id]/_components/answer-requests';
import { useApiAction } from '@/components/api/use-api-action';
import {
  HISTORY_TURNS,
  MAX_QUESTION_LENGTH,
  PRESET_QUESTIONS,
} from '@/domain/assistant';
import { buttonClass } from '@/components/ui/button';
import { CARD, fieldClass } from '@/components/ui/field';
import { ErrorText } from '@/components/ui/notice';

/**
 * "Ask about this story": one-click preset questions and a box for the
 * reader's own, answered from the story's text. Once there is an answer the
 * box asks follow-ups, sending the exchange so far.
 */
export function AskBox({ id }: Readonly<{ id: number }>): ReactElement {
  const { busy, error, run } = useApiAction();
  const [turns, setTurns] = useState<readonly AskTurn[]>([]);
  const [remaining, setRemaining] = useState<number | undefined>(undefined);
  const ask = (input: AskInput, followUp: boolean): void => {
    const history = followUp ? turns.slice(-HISTORY_TURNS) : [];
    void run(async () => {
      const reply = await askArticle(id, { ...input, history });
      setTurns([
        ...history,
        { role: 'user', content: reply.question },
        { role: 'assistant', content: reply.answer },
      ]);
      setRemaining(reply.remaining);
    }, 'Could not answer that.');
  };
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const form = event.currentTarget;
    const question = String(new FormData(form).get('question') ?? '');
    ask({ question }, turns.length > 0);
    form.reset();
  };
  return (
    <section
      id="ask"
      className={`${CARD} mt-12 p-5 sm:p-6`}
      aria-label="Ask about this story"
    >
      <h2 className="text-base font-semibold">Ask about this story</h2>
      <p className="mt-3 flex flex-wrap gap-2">
        {PRESET_QUESTIONS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={buttonClass({
              variant: 'outline',
              size: 'sm',
              className: 'rounded-full border-line',
            })}
            disabled={busy}
            onClick={() => ask({ question_id: preset.id }, false)}
          >
            {preset.label}
          </button>
        ))}
      </p>
      {turns.map((turn, i) => (
        <div
          key={i}
          className={
            turn.role === 'user'
              ? 'mt-4 text-sm font-semibold text-ink'
              : 'mt-2 space-y-3 text-sm leading-relaxed text-ink'
          }
          aria-live="polite"
        >
          {turn.content
            .split(/\n+/)
            .filter(Boolean)
            .map((line, j) => (
              <p key={j}>{line}</p>
            ))}
        </div>
      ))}
      <form className="mt-4 flex flex-col gap-2 sm:flex-row" onSubmit={submit}>
        <input
          name="question"
          type="text"
          placeholder={
            turns.length
              ? 'Ask a follow-up question'
              : 'Ask a question about this story'
          }
          maxLength={MAX_QUESTION_LENGTH}
          required
          className={fieldClass('w-full sm:flex-1')}
        />
        <button className={buttonClass({})} type="submit" disabled={busy}>
          Ask
        </button>
      </form>
      {busy ? <p className="mt-3 text-sm text-muted">Thinking…</p> : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      {remaining !== undefined ? (
        <p className="mt-3 text-sm text-muted">
          {remaining} question{remaining === 1 ? '' : 's'} left today.
        </p>
      ) : null}
    </section>
  );
}
