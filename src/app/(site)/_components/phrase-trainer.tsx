'use client';

import { useState, type ReactElement } from 'react';

import { useApiAction } from '@/components/api/use-api-action';
import { CHIP } from '@/app/(site)/_components/story-actions';
import {
  train,
  type TrainKind,
  type TrainScore,
} from '@/app/(site)/_components/story-requests';

/** What a phrase can be matched against, as NewsBlur's trainer offers. */
const KINDS: ReadonlyArray<readonly [TrainKind, string]> = [
  ['title', 'Title'],
  ['text', 'Text'],
  ['url', 'Address'],
  ['author', 'Author'],
  ['prompt', 'Ask AI'],
];

/** The kinds a phrase may be a regular expression for. */
const REGEX: ReadonlySet<TrainKind> = new Set([
  'title',
  'text',
  'url',
  'author',
]);

/**
 * Train on words of the reader's own: a phrase in the title, text or address,
 * an author, or (Ask AI) a description the AI judges each story against;
 * optionally a regular expression. The phrase starts as the story's title.
 * Reloads the paper once trained.
 */
export function PhraseTrainer({
  title,
}: Readonly<{ title: string }>): ReactElement {
  const [kind, setKind] = useState<TrainKind>('title');
  const [value, setValue] = useState(title);
  const [regex, setRegex] = useState(false);
  const action = useApiAction(() => window.location.reload());
  const scores: ReadonlyArray<readonly [TrainScore, string]> =
    kind === 'prompt'
      ? [
          ['like', 'Focus'],
          ['dislike', 'Hide'],
        ]
      : [
          ['like', '👍'],
          ['dislike', '👎'],
          ['super_dislike', '🚫'],
        ];

  return (
    <span>
      <select
        aria-label="What to match"
        value={kind}
        onChange={(e) => setKind(e.target.value as TrainKind)}
      >
        {KINDS.map(([k, label]) => (
          <option key={k} value={k}>
            {label}
          </option>
        ))}
      </select>{' '}
      <input
        aria-label="Phrase"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />{' '}
      {REGEX.has(kind) ? (
        <label>
          <input
            type="checkbox"
            checked={regex}
            onChange={(e) => setRegex(e.target.checked)}
          />{' '}
          Regex
        </label>
      ) : null}{' '}
      {scores.map(([score, label]) => (
        <button
          key={score}
          type="button"
          className={CHIP}
          disabled={action.busy || !value.trim()}
          onClick={() =>
            void action.run(
              () => train(kind, value, score, regex && REGEX.has(kind)),
              'Could not train.',
            )
          }
        >
          {label}
        </button>
      ))}
      {action.error ? <span role="alert">{action.error}</span> : null}
    </span>
  );
}
