'use client';

import type { ReactElement } from 'react';

import { removeSection } from '@/app/(site)/feeds/_components/feed-requests';
import { useFeedAction } from '@/app/(site)/feeds/_components/use-feed-action';
import { buttonClass } from '@/components/ui/button';

/**
 * "Remove" on a section of the feed manager, which keeps its feeds, and
 * "Remove with feeds", which unfollows the feeds only inside it as deleting a
 * NewsBlur folder does.
 */
export function RemoveSectionButton({
  id,
}: Readonly<{ id: number }>): ReactElement {
  const { busy, error, run } = useFeedAction();
  const className = buttonClass({ variant: 'danger', size: 'xs' });
  return (
    <div className="flex flex-wrap gap-2">
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
      {error ? (
        <span role="alert" className="basis-full text-sm text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}
