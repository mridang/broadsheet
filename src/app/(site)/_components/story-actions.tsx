'use client';

import { useState, type ReactElement } from 'react';

import { useApiAction } from '@/components/api/use-api-action';
import {
  setSaved,
  train as trainOn,
  type TrainKind,
} from '@/app/(site)/_components/story-requests';
import { PhraseTrainer } from '@/app/(site)/_components/phrase-trainer';

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
 * Thumbs up and down on a story's source, a trainer for its feed, author, tags
 * and phrases of the reader's own (see `PhraseTrainer`), and saving the story.
 * Training reloads the page so the paper is set again; saving flips in place.
 * The trainer opens as a panel (a sheet along the bottom on a phone).
 */
export function StoryActions({
  articleId,
  source,
  saved,
  feedId,
  author,
  tags = [],
  title = '',
}: Readonly<{
  articleId: number;
  source: string;
  saved: boolean;
  feedId?: number;
  author?: string | null;
  tags?: readonly string[];
  title?: string;
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
    (['like', 'dislike', 'super_dislike'] as const).map((score) => (
      <button
        key={score}
        type="button"
        className={CHIP}
        disabled={train.busy}
        aria-label={`${
          score === 'like'
            ? 'More'
            : score === 'dislike'
              ? 'Less'
              : 'Never anything'
        } like ${target.label}`}
        onClick={() =>
          void train.run(
            () => trainOn(target.kind, target.value, score),
            'Could not train.',
          )
        }
      >
        {score === 'like' ? '👍' : score === 'dislike' ? '👎' : '🚫'}
      </button>
    ));

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
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
      <details className="relative print:hidden">
        <summary className={CHIP}>Train</summary>
        <div className="pointer-events-auto fixed inset-x-4 bottom-4 z-20 space-y-2 rounded-card border border-line bg-surface p-4 text-sm shadow-lg sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:mt-2 sm:w-80">
          {targets.map((target) => (
            <span
              key={`${target.kind}:${target.value}`}
              className="flex items-center gap-1.5"
            >
              <span className="mr-auto truncate font-medium text-ink">
                {target.label}
              </span>
              {thumbs(target)}
            </span>
          ))}
          <PhraseTrainer title={title} />
        </div>
      </details>
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
