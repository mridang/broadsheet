'use client';

import { useState, type FormEvent, type ReactElement } from 'react';

import { askArticle } from '@/app/(site)/article/[id]/_components/answer-requests';
import { useApiAction } from '@/components/api/use-api-action';
import { MAX_QUESTION_LENGTH, PRESET_QUESTIONS } from '@/domain/assistant';
import { buttonClass } from '@/components/ui/button';
import { CARD, fieldClass } from '@/components/ui/field';
import { ErrorText } from '@/components/ui/notice';

/**
 * "Ask about this story": one-click preset questions and a box for the
 * reader's own, answered from the story's text.
 */
export function AskBox({ id }: Readonly<{ id: number }>): ReactElement {
  const { busy, error, run } = useApiAction();
  const [answer, setAnswer] = useState<string | undefined>(undefined);
  const ask = (question: string): void => {
    setAnswer(undefined);
    void run(
      async () => setAnswer(await askArticle(id, question)),
      'Could not answer that.',
    );
  };
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    ask(String(new FormData(event.currentTarget).get('question') ?? ''));
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
            key={preset.label}
            type="button"
            className={buttonClass({
              variant: 'outline',
              size: 'sm',
              className: 'rounded-full border-line',
            })}
            disabled={busy}
            onClick={() => ask(preset.question)}
          >
            {preset.label}
          </button>
        ))}
      </p>
      <form className="mt-4 flex flex-col gap-2 sm:flex-row" onSubmit={submit}>
        <input
          name="question"
          type="text"
          placeholder="Ask a question about this story"
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
      {answer ? (
        <div
          className="mt-4 space-y-3 text-sm leading-relaxed text-ink"
          aria-live="polite"
        >
          {answer
            .split(/\n+/)
            .filter(Boolean)
            .map((line, i) => (
              <p key={i}>{line}</p>
            ))}
        </div>
      ) : null}
    </section>
  );
}
