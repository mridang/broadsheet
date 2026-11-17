'use client';

import { useState } from 'react';

import { useApiAction } from '@/components/api/use-api-action';
import { CHIP } from '@/components/ui/badge';
import { train } from '@/app/(site)/_components/story-requests';
import { CHECK_LABEL, SMALL_FIELD } from '@/components/ui/field';
import type {
  TrainKind,
  TrainScore,
} from '@/app/(site)/_components/story-requests';
import type { ReactElement } from 'react';

/** A small field, sized to sit beside the trainer's pills. */

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
  const action = useApiAction(() => globalThis.location.reload());
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
    <span className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
      <select
        aria-label="What to match"
        className={SMALL_FIELD}
        value={kind}
        onChange={(event3) => {
          const next = KINDS.find(([k]) => k === event3.target.value);
          if (next) {
            setKind(next[0]);
          }
        }}
      >
        {KINDS.map(([k, label]) => (
          <option key={k} value={k}>
            {label}
          </option>
        ))}
      </select>{' '}
      <input
        aria-label="Phrase"
        className={`${SMALL_FIELD} order-first basis-full`}
        value={value}
        onChange={(event2) => setValue(event2.target.value)}
      />{' '}
      {REGEX.has(kind) ? (
        <label className={CHECK_LABEL}>
          <input
            aria-label="Regex"
            type="checkbox"
            checked={regex}
            onChange={(event) => setRegex(event.target.checked)}
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
          onClick={() => {
            void action.run(
              async () => train(kind, value, score, regex && REGEX.has(kind)),
              'Could not train.',
            );
          }}
        >
          {label}
        </button>
      ))}
      {action.error ? (
        <span className="basis-full text-xs text-danger" role="alert">
          {action.error}
        </span>
      ) : null}
    </span>
  );
}
