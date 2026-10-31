'use client';

import type { ReactElement } from 'react';

import { useApiAction } from '@/components/api/use-api-action';

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
  const { busy, error, run } = useApiAction(() => window.location.reload());
  return (
    <div>
      <button
        type="button"
        className="btn danger"
        disabled={busy}
        onClick={() => void run(remove, failure)}
      >
        {label}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
