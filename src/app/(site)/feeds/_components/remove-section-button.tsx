'use client';

import type { ReactElement } from 'react';

import { removeSection } from '@/app/(site)/feeds/_components/feed-requests';
import { useFeedAction } from '@/app/(site)/feeds/_components/use-feed-action';
import { buttonClass } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/notice';

/** "Remove" on a section of the feed manager; its feeds stay. */
export function RemoveSectionButton({
  id,
}: Readonly<{ id: number }>): ReactElement {
  const { busy, error, run } = useFeedAction();
  return (
    <div>
      <button
        type="button"
        className={buttonClass({
          variant: 'ghost',
          size: 'sm',
          className:
            'text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950',
        })}
        disabled={busy}
        onClick={() =>
          void run(() => removeSection(id), 'Could not remove that section.')
        }
      >
        Remove
      </button>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </div>
  );
}
