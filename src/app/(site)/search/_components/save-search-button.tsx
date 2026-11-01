'use client';

import type { ReactElement } from 'react';

import { useApiAction } from '@/components/api/use-api-action';
import { buttonClass } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/notice';
import { saveSearch } from '@/app/(site)/search/_components/search-requests';

/** "Save this search" under the results: keeps the words to run again. */
export function SaveSearchButton({
  query,
  feedId,
}: Readonly<{ query: string; feedId?: string }>): ReactElement {
  const { busy, error, run } = useApiAction(() => window.location.reload());
  return (
    <div>
      <button
        type="button"
        className={buttonClass({ variant: 'outline', size: 'sm' })}
        disabled={busy}
        onClick={() =>
          void run(
            () => saveSearch(query, feedId),
            'Could not save that search.',
          )
        }
      >
        Save this search
      </button>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </div>
  );
}
