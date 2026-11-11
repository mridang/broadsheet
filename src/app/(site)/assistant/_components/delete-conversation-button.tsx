'use client';

import type { ReactElement } from 'react';

import { deleteConversation } from '@/app/(site)/assistant/_components/assistant-requests';
import { useApiAction } from '@/components/api/use-api-action';
import { buttonClass } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/notice';

/** "Delete" beside a past conversation; reloads the assistant without it. */
export function DeleteConversationButton({
  id,
}: Readonly<{ id: string }>): ReactElement {
  const { busy, error, run } = useApiAction(() =>
    globalThis.location.assign('/assistant'),
  );
  return (
    <div>
      <button
        type="button"
        className={buttonClass({ variant: 'danger', size: 'xs' })}
        disabled={busy}
        onClick={() =>
          void run(
            () => deleteConversation(id),
            'Could not delete that conversation.',
          )
        }
      >
        Delete
      </button>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </div>
  );
}
