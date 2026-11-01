'use client';

import { useState, type FormEvent, type ReactElement } from 'react';

import {
  sendMessage,
  startConversation,
  type Turn,
} from '@/app/(site)/assistant/_components/assistant-requests';
import { useApiAction } from '@/components/api/use-api-action';
import { MAX_QUESTION_LENGTH } from '@/domain/assistant';
import { buttonClass } from '@/components/ui/button';
import { CARD, fieldClass } from '@/components/ui/field';
import { ErrorText } from '@/components/ui/notice';
import { cn } from '@/components/ui/cn';

/** One turn as the chat shows it, with links to the stories it cites. */
function TurnView({ turn }: Readonly<{ turn: Turn }>): ReactElement {
  return (
    <div
      className={cn(
        'max-w-[85%] rounded-card px-4 py-3 text-sm leading-relaxed',
        turn.role === 'user'
          ? 'ml-auto bg-ink text-on-ink'
          : 'border border-line bg-surface text-ink',
      )}
    >
      <strong className="block text-xs font-semibold opacity-70">
        {turn.role === 'user' ? 'You' : 'Assistant'}
      </strong>
      {turn.content
        .split(/\n+/)
        .filter(Boolean)
        .map((line, i) => (
          <p key={i} className="mt-1">
            {line}
          </p>
        ))}
      {turn.citations.length ? (
        <ol className="mt-3 space-y-1 border-t border-line pt-3">
          {turn.citations.map((c) => (
            <li key={c.article_id}>
              <a
                className="focus-ring rounded-sm text-xs font-medium text-accent hover:underline"
                href={c.href}
              >
                {c.title || `Story ${c.article_id}`}
              </a>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

/**
 * A conversation with the archive assistant. The conversation is started on
 * the first question; each answer cites the stories it drew on.
 */
export function AssistantChat(): ReactElement {
  const { busy, error, run } = useApiAction();
  const [conversation, setConversation] = useState<string | undefined>();
  const [turns, setTurns] = useState<readonly Turn[]>([]);
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const form = event.currentTarget;
    const content = String(new FormData(form).get('content') ?? '').trim();
    if (!content) return;
    void run(async () => {
      const id = conversation ?? (await startConversation());
      setConversation(id);
      const answer = await sendMessage(id, content);
      setTurns((was) => [
        ...was,
        { id: `q${answer.id}`, role: 'user', content, citations: [] },
        answer,
      ]);
      form.reset();
    }, 'The assistant could not answer.');
  };
  return (
    <>
      <div aria-live="polite" className="space-y-3">
        {turns.map((turn) => (
          <TurnView key={turn.id} turn={turn} />
        ))}
      </div>
      <form
        className={cn(
          CARD,
          'mt-6 flex flex-col gap-2 p-2 sm:flex-row sm:items-center',
        )}
        onSubmit={submit}
      >
        <input
          name="content"
          type="text"
          placeholder="Ask about anything in your archive"
          maxLength={MAX_QUESTION_LENGTH}
          required
          className={fieldClass('w-full border-transparent sm:flex-1')}
        />
        <button className={buttonClass({})} type="submit" disabled={busy}>
          Ask
        </button>
      </form>
      {busy ? (
        <p className="mt-3 text-sm text-muted">Searching your archive…</p>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </>
  );
}
