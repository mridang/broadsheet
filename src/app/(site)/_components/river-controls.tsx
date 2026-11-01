'use client';

import type { FormEvent, ReactElement } from 'react';

import { useApiAction } from '@/components/api/use-api-action';
import { buttonClass } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/notice';
import { pinRiver, unpinRiver } from '@/app/(site)/_components/river-requests';

/** Something a river can list, as the picker offers it. */
export interface RiverOption {
  readonly river_id: string;
  readonly label: string;
}

/** "Pin a river": pick what it lists and the column it goes at the end of. */
export function RiverPicker({
  options,
  next,
}: Readonly<{
  options: readonly RiverOption[];
  next: Readonly<{ left: number; right: number }>;
}>): ReactElement {
  const { busy, error, run } = useApiAction(() => window.location.reload());
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const side = data.get('side') === 'right' ? 'right' : 'left';
    void run(
      () => pinRiver(String(data.get('river_id')), side, next[side]),
      'Could not pin that river.',
    );
  };
  return (
    <details>
      <summary>Pin a river</summary>
      <form
        className="mt-3 flex flex-wrap items-center gap-2"
        onSubmit={submit}
      >
        <select name="river_id" aria-label="Stories from">
          {options.map((o) => (
            <option key={o.river_id} value={o.river_id}>
              {o.label}
            </option>
          ))}
        </select>
        <select name="side" aria-label="Column">
          <option value="left">Left</option>
          <option value="right">Right</option>
        </select>
        <button
          className={buttonClass({ size: 'sm' })}
          type="submit"
          disabled={busy}
        >
          Pin
        </button>
        {error ? <ErrorText>{error}</ErrorText> : null}
      </form>
    </details>
  );
}

/** "Unpin" on a river. */
export function UnpinRiverButton({
  id,
}: Readonly<{ id: number }>): ReactElement {
  const { busy, error, run } = useApiAction(() => window.location.reload());
  return (
    <>
      <button
        type="button"
        className={buttonClass({ variant: 'danger', size: 'sm' })}
        disabled={busy}
        onClick={() =>
          void run(() => unpinRiver(id), 'Could not unpin that river.')
        }
      >
        Unpin
      </button>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </>
  );
}
