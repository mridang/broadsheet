'use client';

import { useState, type ReactElement } from 'react';

import { useApiAction } from '@/components/api/use-api-action';
import {
  setSaved,
  train as trainOn,
  type TrainKind,
} from '@/app/(site)/_components/story-requests';
import { PhraseTrainer } from '@/app/(site)/_components/phrase-trainer';
import { CHIP } from '@/components/ui/badge';
import { IconButton } from '@/components/ui/button';
import { Icon } from '@/components/ui/icons';
import { MENU_ITEM } from '@/components/ui/menu';

/** Something about a story the reader can like or dislike. */
interface Target {
  readonly kind: TrainKind;
  readonly value: string;
  readonly label: string;
}

export { CHIP } from '@/components/ui/badge';

/**
 * Thumbs up and down on a story's source, and a trainer for its feed, author,
 * tags and phrases of the reader's own (see `PhraseTrainer`), laid out to sit
 * inside the story's menu. Training reloads the page so the paper is set
 * again.
 */
export function StoryActions({
  articleId,
  saved = false,
  source,
  feedId,
  author,
  tags = [],
  title = '',
}: Readonly<{
  /** With it, the save button is shown alongside (outside a story's menu). */
  articleId?: number;
  saved?: boolean;
  source: string;
  feedId?: number;
  author?: string | null;
  tags?: readonly string[];
  title?: string;
}>): ReactElement {
  const train = useApiAction(() => window.location.reload());
  const error = train.error;
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
    <span className="flex flex-wrap items-center gap-1.5 px-1.5 pt-1">
      <span className="mr-auto px-1.5 text-xs text-subtle">{source}</span>
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
      <details className="w-full print:hidden">
        <summary className={MENU_ITEM}>Train on this story…</summary>
        <div className="mt-1 space-y-2 px-3 pb-2 text-sm">
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
      {articleId !== undefined ? (
        <SaveButton articleId={articleId} saved={saved} title={title} />
      ) : null}
      {error ? (
        <span className="w-full px-3 text-xs text-danger" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Save a story for later (or let it go), as a bookmark beside the story's
 * menu. It flips in place.
 */
export function SaveButton({
  articleId,
  saved,
  title,
}: Readonly<{
  articleId: number;
  saved: boolean;
  title: string;
}>): ReactElement {
  const save = useApiAction();
  const [isSaved, setIsSaved] = useState(saved);
  return (
    <>
      <IconButton
        label={`${isSaved ? 'Saved' : 'Save'} ${title}`.trim()}
        className="pointer-events-auto relative z-10"
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
        <Icon
          name="bookmark"
          className={isSaved ? 'size-4.5 fill-current' : 'size-4.5'}
        />
      </IconButton>
      {save.error ? (
        <span className="text-xs text-danger" role="alert">
          {save.error}
        </span>
      ) : null}
    </>
  );
}
