'use client';

import type { ReactElement } from 'react';

import { RemoveButton } from '@/app/(site)/settings/_components/remove-button';
import { revokeToken } from '@/app/(site)/settings/_components/settings-requests';

/** "Revoke" on a feed token row. */
export function RevokeTokenButton({
  id,
}: Readonly<{ id: number }>): ReactElement {
  return (
    <RemoveButton
      remove={() => revokeToken(id)}
      label="Revoke"
      failure="Could not revoke that feed."
    />
  );
}
