'use client';

import { RemoveButton } from '@/app/(site)/settings/_components/remove-button';
import { revokeToken } from '@/app/(site)/settings/_components/settings-requests';
import type { ReactElement } from 'react';

/** "Revoke" on a feed token row. */
export function RevokeTokenButton({
  id,
}: Readonly<{ id: number }>): ReactElement {
  return (
    <RemoveButton
      remove={async () => revokeToken(id)}
      label="Revoke"
      failure="Could not revoke that feed."
    />
  );
}
