'use client';

import { useRef, useState, type FormEvent, type ReactElement } from 'react';

import {
  importOpml,
  type ImportProgress,
} from '@/app/(site)/feeds/_components/feed-requests';
import { useApiAction } from '@/components/api/use-api-action';
import { buttonClass } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/notice';
import { countOf } from '@/lib/intl';

/** Follow the feeds of an OPML file exported from another reader. */
export function ImportFeedsForm(): ReactElement {
  const { busy, error, run } = useApiAction();
  const [progress, setProgress] = useState<ImportProgress>();
  const form = useRef<HTMLFormElement>(null);
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const file = new FormData(event.currentTarget).get('file');
    if (!(file instanceof File) || file.size === 0) return;
    void run(async () => {
      const done = await importOpml(file, setProgress);
      const query = new URLSearchParams({
        added: String(done.added),
        skipped: String(done.skipped),
        rejected: String(done.rejected.length),
      });
      globalThis.location.assign(`/feeds?${query.toString()}`);
    }, 'Could not import that file.');
  };
  return (
    <>
      <form ref={form} onSubmit={submit}>
        <label
          className={buttonClass({
            variant: 'outline',
            className:
              'w-full has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ink sm:w-auto',
          })}
          aria-disabled={busy}
        >
          Import OPML
          <input
            name="file"
            type="file"
            accept=".opml, .xml, text/x-opml, text/xml"
            aria-label="OPML file"
            className="sr-only"
            required
            disabled={busy}
            onChange={() => form.current?.requestSubmit()}
          />
        </label>
      </form>
      {progress ? (
        <p className="mt-2 text-sm text-muted" role="status">
          {progress.status === 'running' ? 'Importing' : 'Imported'}{' '}
          {progress.processed} of {countOf(progress.total, 'feed')}:{' '}
          {progress.added} added, {progress.skipped} skipped,{' '}
          {progress.rejected.length} failed.
        </p>
      ) : null}
      {error ? <ErrorText>{error}</ErrorText> : null}
    </>
  );
}
