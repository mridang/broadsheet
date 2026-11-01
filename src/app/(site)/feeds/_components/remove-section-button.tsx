'use client';

import type { ReactElement } from 'react';

import { removeSection } from '@/app/(site)/feeds/_components/feed-requests';
import { useFeedAction } from '@/app/(site)/feeds/_components/use-feed-action';
import { buttonClass } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/notice';

/**
 * "Remove" on a section of the feed manager, which keeps its feeds, and
 * "Remove with feeds", which unfollows the feeds only inside it as deleting a
 * NewsBlur folder does.
 */
export function RemoveSectionButton({
  id,
}: Readonly<{ id: number }>): ReactElement {
  const { busy, error, run } = useFeedAction();
  const className = buttonClass({
    variant: 'ghost',
    size: 'sm',
    className:
      'text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950',
  });
  return (
    <div>
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={() =>
          void run(() => removeSection(id), 'Could not remove that section.')
        }
      >
        Remove
      </button>
      <button
        type="button"
        className={className}
        disabled={busy}
        onClick={() =>
          void run(
            () => removeSection(id, true),
            'Could not remove that section.',
          )
        }
      >
        Remove with feeds
      </button>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </div>
  );
}
