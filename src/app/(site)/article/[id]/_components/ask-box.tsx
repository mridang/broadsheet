'use client';

import { Chip } from '@/components/ui/badge';
import { SectionHeader } from '@/components/ui/page-header';
import { useRef, useState, type SubmitEvent, type ReactElement } from 'react';

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
import { Button } from '@/components/ui/button';
import { CARD, CHECK_LABEL, SMALL_FIELD } from '@/components/ui/field';
import { ErrorText } from '@/components/ui/notice';
import { countOf } from '@/lib/intl';

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
  const submit = (event: SubmitEvent<HTMLFormElement>): void => {
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
      <SectionHeader as="h2" title="Ask about this story" />
      <p className="mt-3 flex flex-wrap gap-2">
        {PRESET_QUESTIONS.map((preset) => (
          <Chip
            key={preset.id}
            disabled={busy}
            onClick={() => ask({ question_id: preset.id }, false)}
          >
            {preset.label}
          </Chip>
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
            turns.length > 0
              ? 'Ask a follow-up question'
              : 'Ask a question about this story'
          }
          maxLength={MAX_QUESTION_LENGTH}
          required
          className="w-full sm:flex-1"
          ref={field}
        />
        <VoiceButton
          disabled={busy}
          onText={(text) => {
            if (field.current) field.current.value = text;
          }}
        />
        <Button type="submit" disabled={busy}>
          Ask
        </Button>
      </form>
      <p className="mt-3 flex flex-wrap items-center gap-4">
        <label className={CHECK_LABEL}>
          Model
          <select
            className={SMALL_FIELD}
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
            checked={thinking}
            onChange={(event) => setThinking(event.currentTarget.checked)}
          />
          Think it through
        </label>
      </p>
      {busy ? <p className="mt-3 text-sm text-muted">Thinking…</p> : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
      {remaining === undefined ? null : (
        <p className="mt-3 text-sm text-muted">
          {countOf(remaining, 'question')} left today.
        </p>
      )}
    </section>
  );
}
