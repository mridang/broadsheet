'use client';

import { useState, type FormEvent, type ReactElement } from 'react';

import {
  importOpml,
  type ImportProgress,
} from '@/app/(site)/feeds/_components/feed-requests';
import { useApiAction } from '@/components/api/use-api-action';
import { buttonClass } from '@/components/ui/button';
import { fieldClass } from '@/components/ui/field';
import { ErrorText } from '@/components/ui/notice';

/** Follow the feeds of an OPML file exported from another reader. */
export function ImportFeedsForm(): ReactElement {
  const { busy, error, run } = useApiAction();
  const [progress, setProgress] = useState<ImportProgress>();
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const file = new FormData(event.currentTarget).get('file');
    if (!(file instanceof File) || !file.size) return;
    void run(async () => {
      const done = await importOpml(file, setProgress);
      const query = new URLSearchParams({
        added: String(done.added),
        skipped: String(done.skipped),
        rejected: String(done.rejected.length),
      });
      window.location.assign(`/feeds?${query.toString()}`);
    }, 'Could not import that file.');
  };
  return (
    <>
      <form
        className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center"
        onSubmit={submit}
      >
        <input
          name="file"
          type="file"
          accept=".opml,.xml,text/x-opml,text/xml"
          aria-label="OPML file"
          className={fieldClass('w-full sm:flex-1')}
          required
        />
        <button
          className={buttonClass({
            variant: 'outline',
            className: 'border-line',
          })}
          type="submit"
          disabled={busy}
        >
          Import OPML
        </button>
      </form>
      {progress ? (
        <p className="mt-2 text-sm text-muted" role="status">
          {progress.status === 'running' ? 'Importing' : 'Imported'}{' '}
          {progress.processed} of {progress.total} feeds: {progress.added}{' '}
          added, {progress.skipped} skipped, {progress.rejected.length} failed.
        </p>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </>
  );
}
