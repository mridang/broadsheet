'use client';

import type { ReactElement } from 'react';

import { useApiAction } from '@/components/api/use-api-action';
import { Button } from '@/components/ui/button';
import { markFeedRead } from '@/app/(site)/_components/story-requests';

/** Marks every unread story of one feed read, then reloads the paper. */
export function MarkFeedReadButton({
  feedId,
}: Readonly<{ feedId: number }>): ReactElement {
  const action = useApiAction(() => globalThis.location.reload());
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        disabled={action.busy}
        onClick={() =>
          void action.run(() => markFeedRead(feedId), 'Could not mark read.')
        }
      >
        Mark read
      </Button>
      {action.error ? <span role="alert">{action.error}</span> : null}
    </>
  );
}
