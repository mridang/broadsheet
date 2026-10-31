'use client';

import type { ReactElement } from 'react';

import { useApiAction } from '@/components/api/use-api-action';
import { removeEdition } from '@/app/(site)/editions/_components/edition-requests';

/** "Remove" on a custom edition; its stored issues go with it. */
export function RemoveEditionButton({
  id,
}: Readonly<{ id: number }>): ReactElement {
  const { busy, error, run } = useApiAction(() => window.location.reload());
  return (
    <div>
      <button
        type="button"
        className="btn danger"
        disabled={busy}
        onClick={() =>
          void run(() => removeEdition(id), 'Could not remove that edition.')
        }
      >
        Remove
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
