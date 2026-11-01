'use client';

import { useState, type FormEvent, type ReactElement } from 'react';

import { askArticle } from '@/app/(site)/article/[id]/_components/answer-requests';
import { useApiAction } from '@/components/api/use-api-action';
import { MAX_QUESTION_LENGTH, PRESET_QUESTIONS } from '@/domain/assistant';

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
    <section id="ask" className="ask" aria-label="Ask about this story">
      <h2>Ask about this story</h2>
      <p>
        {PRESET_QUESTIONS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className="btn small ghost"
            disabled={busy}
            onClick={() => ask(preset.question)}
          >
            {preset.label}
          </button>
        ))}
      </p>
      <form className="addform" onSubmit={submit}>
        <input
          name="question"
          type="text"
          placeholder="Ask a question about this story"
          maxLength={MAX_QUESTION_LENGTH}
          required
        />
        <button className="btn" type="submit" disabled={busy}>
          Ask
        </button>
      </form>
      {busy ? <p className="muted">Thinking…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {answer ? (
        <div className="story-body" aria-live="polite">
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
