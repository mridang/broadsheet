'use client';

import { useState, type ReactElement } from 'react';

import { useApiAction } from '@/components/api/use-api-action';
import {
  setSaved,
  train as trainOn,
  type TrainKind,
} from '@/app/(site)/_components/story-requests';

/** Something about a story the reader can like or dislike. */
interface Target {
  readonly kind: TrainKind;
  readonly value: string;
  readonly label: string;
}

/** The look of each control: a small pill, tinted while pressed. */
export const CHIP =
  'focus-ring pointer-events-auto relative z-10 inline-flex h-7 items-center gap-1 rounded-full border border-line px-2.5 text-xs font-medium text-muted hover:border-field hover:text-ink aria-pressed:border-accent aria-pressed:text-accent disabled:opacity-50';

/**
 * Thumbs up and down on a story's source, a trainer for its feed, author and
 * tags, and saving the story. Training reloads the page so the paper is set
 * again; saving flips in place.
 */
export function StoryActions({
  articleId,
  source,
  saved,
  feedId,
  author,
  tags = [],
}: Readonly<{
  articleId: number;
  source: string;
  saved: boolean;
  feedId?: number;
  author?: string | null;
  tags?: readonly string[];
}>): ReactElement {
  const train = useApiAction(() => window.location.reload());
  const save = useApiAction();
  const [isSaved, setIsSaved] = useState(saved);
  const error = train.error ?? save.error;
  const targets: Target[] = [
    ...(feedId !== undefined
      ? [{ kind: 'feed' as const, value: String(feedId), label: 'This feed' }]
      : []),
    ...(author
      ? [{ kind: 'author' as const, value: author, label: author }]
      : []),
    ...tags.map((t) => ({ kind: 'tag' as const, value: t, label: `#${t}` })),
  ];
  const thumbs = (target: Target) =>
    (['like', 'dislike'] as const).map((score) => (
      <button
        key={score}
        type="button"
        className={CHIP}
        disabled={train.busy}
        aria-label={`${score === 'like' ? 'More' : 'Less'} like ${target.label}`}
        onClick={() =>
          void train.run(
            () => trainOn(target.kind, target.value, score),
            'Could not train.',
          )
        }
      >
        {score === 'like' ? '👍' : '👎'}
      </button>
    ));

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        className={CHIP}
        disabled={train.busy}
        aria-label={`More from ${source}`}
        title={`More from ${source}`}
        onClick={() =>
          void train.run(
            () => trainOn('source', source, 'like'),
            'Could not train.',
          )
        }
      >
        👍
      </button>
      <button
        type="button"
        className={CHIP}
        disabled={train.busy}
        aria-label={`Less from ${source}`}
        title={`Less from ${source}`}
        onClick={() =>
          void train.run(
            () => trainOn('source', source, 'dislike'),
            'Could not train.',
          )
        }
      >
        👎
      </button>
      {targets.length ? (
        <details>
          <summary>Train</summary>
          {targets.map((target) => (
            <span key={`${target.kind}:${target.value}`}>
              {target.label} {thumbs(target)}
            </span>
          ))}
        </details>
      ) : null}
      <button
        type="button"
        className={CHIP}
        data-action="save"
        disabled={save.busy}
        aria-pressed={isSaved}
        onClick={() =>
          void save.run(async () => {
            await setSaved(articleId, !isSaved);
            setIsSaved(!isSaved);
          }, 'Could not save.')
        }
      >
        {isSaved ? 'Saved' : 'Save'}
      </button>
      {error ? (
        <span
          className="relative z-10 text-xs text-red-700 dark:text-red-400"
          role="alert"
        >
          {error}
        </span>
      ) : null}
    </span>
  );
}
