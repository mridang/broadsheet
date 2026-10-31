'use client';

import type { ReactElement } from 'react';

import { removeSection } from '@/app/(site)/feeds/_components/feed-requests';
import { useFeedAction } from '@/app/(site)/feeds/_components/use-feed-action';

/** "Remove" on a section of the feed manager; its feeds stay. */
export function RemoveSectionButton({
  id,
}: Readonly<{ id: number }>): ReactElement {
  const { busy, error, run } = useFeedAction();
  return (
    <div>
      <button
        type="button"
        className="btn danger"
        disabled={busy}
        onClick={() =>
          void run(() => removeSection(id), 'Could not remove that section.')
        }
      >
        Remove
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
