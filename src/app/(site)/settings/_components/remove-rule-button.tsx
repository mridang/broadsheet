'use client';

import type { ReactElement } from 'react';

import { RemoveButton } from '@/app/(site)/settings/_components/remove-button';
import { removeRule } from '@/app/(site)/settings/_components/settings-requests';

/** "Remove" on a notification rule row. */
export function RemoveRuleButton({
  id,
}: Readonly<{ id: number }>): ReactElement {
  return (
    <RemoveButton
      remove={() => removeRule(id)}
      failure="Could not remove that rule."
    />
  );
}
