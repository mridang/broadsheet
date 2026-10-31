'use client';

import { useState, type ReactElement } from 'react';

import { useApiAction } from '@/components/api/use-api-action';
import { setSaved, trainSource } from '@/app/(site)/_components/story-requests';

/**
 * Thumbs up and down on a story's source, and saving the story. Training
 * reloads the page so the paper is set again; saving flips in place.
 */
export function StoryActions({
  articleId,
  source,
  saved,
}: Readonly<{
  articleId: number;
  source: string;
  saved: boolean;
}>): ReactElement {
  const train = useApiAction(() => window.location.reload());
  const save = useApiAction();
  const [isSaved, setIsSaved] = useState(saved);
  const error = train.error ?? save.error;

  return (
    <span className="actions">
      <button
        type="button"
        className="act focus-ring"
        disabled={train.busy}
        aria-label={`More from ${source}`}
        title={`More from ${source}`}
        onClick={() =>
          void train.run(() => trainSource(source, 'like'), 'Could not train.')
        }
      >
        👍
      </button>
      <button
        type="button"
        className="act focus-ring"
        disabled={train.busy}
        aria-label={`Less from ${source}`}
        title={`Less from ${source}`}
        onClick={() =>
          void train.run(
            () => trainSource(source, 'dislike'),
            'Could not train.',
          )
        }
      >
        👎
      </button>
      <button
        type="button"
        className="act focus-ring"
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
        <span className="act-error" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
