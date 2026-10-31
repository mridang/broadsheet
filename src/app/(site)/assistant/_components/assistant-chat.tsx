'use client';

import { useState, type FormEvent, type ReactElement } from 'react';

import {
  sendMessage,
  startConversation,
  type Turn,
} from '@/app/(site)/assistant/_components/assistant-requests';
import { useApiAction } from '@/components/api/use-api-action';
import { MAX_QUESTION_LENGTH } from '@/domain/assistant';

/** One turn as the chat shows it, with links to the stories it cites. */
function TurnView({ turn }: Readonly<{ turn: Turn }>): ReactElement {
  return (
    <div className={turn.role === 'user' ? 'turn mine' : 'turn'}>
      <strong>{turn.role === 'user' ? 'You' : 'Assistant'}</strong>
      {turn.content
        .split(/\n+/)
        .filter(Boolean)
        .map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      {turn.citations.length ? (
        <ol className="citations">
          {turn.citations.map((c) => (
            <li key={c.article_id}>
              <a className="more focus-ring" href={c.href}>
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
      <div aria-live="polite">
        {turns.map((turn) => (
          <TurnView key={turn.id} turn={turn} />
        ))}
      </div>
      <form className="addform" onSubmit={submit}>
        <input
          name="content"
          type="text"
          placeholder="Ask about anything in your archive"
          maxLength={MAX_QUESTION_LENGTH}
          required
        />
        <button className="btn" type="submit" disabled={busy}>
          Ask
        </button>
      </form>
      {busy ? <p className="muted">Searching your archive…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </>
  );
}
