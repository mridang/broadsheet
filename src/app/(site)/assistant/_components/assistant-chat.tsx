'use client';

import { Chip } from '@/components/ui/badge';
import { TextLink, buttonClass } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useState, type SubmitEvent, type ReactElement } from 'react';

import {
  sendMessage,
  startConversation,
  type Turn,
} from '@/app/(site)/assistant/_components/assistant-requests';
import { useApiAction } from '@/components/api/use-api-action';
import { Markdown } from '@/components/site/markdown';
import { MAX_QUESTION_LENGTH } from '@/domain/assistant';
import { CARD } from '@/components/ui/field';
import { ErrorText } from '@/components/ui/notice';
import { cn } from '@/components/ui/cn';

/** One turn as the chat shows it, with links to the stories it cites. */
function TurnView({ turn }: Readonly<{ turn: Turn }>): ReactElement {
  return (
    <div
      className={cn(
        'max-w-prose rounded-card px-4 py-3 text-sm leading-relaxed sm:max-w-[85%]',
        turn.role === 'user'
          ? 'ml-auto w-fit bg-ink/6 text-ink'
          : 'border border-line bg-surface text-ink',
      )}
    >
      <strong className="block text-xs font-semibold text-subtle">
        {turn.role === 'user' ? 'You' : 'Assistant'}
      </strong>
      <Markdown text={turn.content} className="mt-1 space-y-2" />
      {turn.citations.length > 0 ? (
        <ol className="mt-3 space-y-1 border-t border-line pt-3">
          {turn.citations.map((c) => (
            <li key={c.article_id}>
              <TextLink
                tone="accent"
                className="text-xs font-medium"
                href={c.href}
              >
                {c.title || `Story ${c.article_id}`}
              </TextLink>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

/**
 * A conversation with the archive assistant. The conversation is started on
 * the first question (or reopened with its turns); each answer cites the
 * stories it drew on. Before the first question it offers suggestions.
 */
export function AssistantChat({
  conversationId,
  initialTurns = [],
  suggestions = [],
}: Readonly<{
  conversationId?: string;
  initialTurns?: readonly Turn[];
  suggestions?: readonly string[];
}>): ReactElement {
  const { busy, error, run } = useApiAction();
  const [conversation, setConversation] = useState<string | undefined>(
    conversationId,
  );
  const [turns, setTurns] = useState<readonly Turn[]>(initialTurns);
  const send = (content: string, form?: HTMLFormElement): void => {
    void run(async () => {
      const id = conversation ?? (await startConversation());
      setConversation(id);
      const answer = await sendMessage(id, content);
      setTurns((was) => [
        ...was,
        { id: `q${answer.id}`, role: 'user', content, citations: [] },
        answer,
      ]);
      form?.reset();
    }, 'The assistant could not answer.');
  };
  const submit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const form = event.currentTarget;
    const content = String(new FormData(form).get('content') ?? '').trim();
    if (content) send(content, form);
  };
  return (
    <>
      {turns.length === 0 && suggestions.length > 0 ? (
        <p className="mb-4 flex flex-wrap gap-2">
          {suggestions.map((question) => (
            <Chip key={question} disabled={busy} onClick={() => send(question)}>
              {question}
            </Chip>
          ))}
        </p>
      ) : null}
      <div aria-live="polite" className="space-y-3">
        {turns.map((turn) => (
          <TurnView key={turn.id} turn={turn} />
        ))}
      </div>
      <form
        className={cn(
          CARD,
          'mt-6 flex flex-col gap-2 p-2 shadow-raised focus-within:border-field sm:flex-row sm:items-center',
        )}
        onSubmit={submit}
      >
        <input
          name="content"
          type="text"
          placeholder="Ask about anything in your archive"
          maxLength={MAX_QUESTION_LENGTH}
          required
          aria-label="Your question"
          className="w-full border-transparent hover:border-transparent sm:flex-1"
        />
        <button className={buttonClass({})} type="submit" disabled={busy}>
          Ask
        </button>
      </form>
      {busy ? (
        <div className="mt-4 max-w-md space-y-2">
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-3.5 w-1/2" />
          <p className="text-sm text-muted">Searching your archive…</p>
        </div>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </>
  );
}
