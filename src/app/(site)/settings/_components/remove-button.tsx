'use client';

import type { ReactElement } from 'react';

import { useApiAction } from '@/components/api/use-api-action';
import { buttonClass } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/notice';

/** A "Remove" on a settings row: runs `remove`, then reloads to show the change. */
export function RemoveButton({
  remove,
  label = 'Remove',
  failure,
}: Readonly<{
  remove: () => Promise<void>;
  label?: string;
  failure: string;
}>): ReactElement {
  const { busy, error, run } = useApiAction(() => globalThis.location.reload());
  return (
    <div>
      <button
        type="button"
        className={buttonClass({ variant: 'danger', size: 'sm' })}
        disabled={busy}
        onClick={() => void run(remove, failure)}
      >
        {label}
      </button>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </div>
  );
}
