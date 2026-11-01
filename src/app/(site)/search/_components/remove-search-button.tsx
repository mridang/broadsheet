'use client';

import type { ReactElement } from 'react';

import { useApiAction } from '@/components/api/use-api-action';
import { buttonClass } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/notice';
import { removeSearch } from '@/app/(site)/search/_components/search-requests';

/** "Remove" on a saved search. */
export function RemoveSearchButton({
  id,
}: Readonly<{ id: number }>): ReactElement {
  const { busy, error, run } = useApiAction(() => window.location.reload());
  return (
    <>
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
          void run(() => removeSearch(id), 'Could not remove that search.')
        }
      >
        Remove
      </button>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </>
  );
}
