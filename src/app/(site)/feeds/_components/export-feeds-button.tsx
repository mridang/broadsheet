'use client';

import type { ReactElement } from 'react';

import { fetchOpml } from '@/app/(site)/feeds/_components/feed-requests';
import { useApiAction } from '@/components/api/use-api-action';
import { buttonClass } from '@/components/ui/button';

/** "Export OPML": download the followed feeds, sections as folders. */
export function ExportFeedsButton(): ReactElement {
  const { busy, error, run } = useApiAction();
  const download = async (): Promise<void> => {
    const url = URL.createObjectURL(await fetchOpml());
    const link = document.createElement('a');
    link.href = url;
    link.download = 'broadsheet.opml';
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <>
      <button
        type="button"
        className={buttonClass({ variant: 'outline', size: 'sm' })}
        disabled={busy}
        onClick={() => void run(download, 'Could not export the feeds.')}
      >
        Export OPML
      </button>
      {error ? (
        <span role="alert" className="text-sm text-danger">
          {' '}
          {error}
        </span>
      ) : null}
    </>
  );
}
