'use client';

import type { ReactElement } from 'react';

import { RemoveButton } from '@/app/(site)/settings/_components/remove-button';
import { removeWebhook } from '@/app/(site)/settings/_components/settings-requests';

/** "Remove" on a webhook row. */
export function RemoveWebhookButton({
  id,
}: Readonly<{ id: number }>): ReactElement {
  return (
    <RemoveButton
      remove={() => removeWebhook(id)}
      failure="Could not remove that webhook."
    />
  );
}
