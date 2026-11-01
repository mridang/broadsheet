'use client';

import { useRef, useState, type FormEvent, type ReactElement } from 'react';

import {
  askArticle,
  type AskInput,
  type AskTurn,
} from '@/app/(site)/article/[id]/_components/answer-requests';
import { useApiAction } from '@/components/api/use-api-action';
import { VoiceButton } from '@/app/(site)/article/[id]/_components/voice-button';
import { Markdown } from '@/components/site/markdown';
import {
  ANSWER_MODELS,
  HISTORY_TURNS,
  type AnswerModelName,
  MAX_QUESTION_LENGTH,
  PRESET_QUESTIONS,
} from '@/domain/assistant';
import { buttonClass } from '@/components/ui/button';
import { CARD, CHECKBOX, CHECK_LABEL, fieldClass } from '@/components/ui/field';
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
  const [model, setModel] = useState<AnswerModelName>('fast');
  const [thinking, setThinking] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const ask = (input: AskInput, followUp: boolean): void => {
    const history = followUp ? turns.slice(-HISTORY_TURNS) : [];
    void run(async () => {
      const reply = await askArticle(id, {
        ...input,
        history,
        model,
        thinking,
      });
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
          <Markdown text={turn.content} className="space-y-3" />
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
          ref={field}
        />
        <VoiceButton
          disabled={busy}
          onText={(text) => {
            if (field.current) field.current.value = text;
          }}
        />
        <button className={buttonClass({})} type="submit" disabled={busy}>
          Ask
        </button>
      </form>
      <p className="mt-3 flex flex-wrap items-center gap-4">
        <label className={CHECK_LABEL}>
          Model
          <select
            className={fieldClass('h-9')}
            value={model}
            onChange={(event) =>
              setModel(event.currentTarget.value as AnswerModelName)
            }
          >
            {Object.keys(ANSWER_MODELS).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className={CHECK_LABEL}>
          <input
            type="checkbox"
            className={CHECKBOX}
            checked={thinking}
            onChange={(event) => setThinking(event.currentTarget.checked)}
          />
          Think it through
        </label>
      </p>
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
