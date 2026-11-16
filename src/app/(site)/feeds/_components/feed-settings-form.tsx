'use client';

import type { SubmitEvent, ReactElement } from 'react';

import { editFeed } from '@/app/(site)/feeds/_components/feed-requests';
import { useFeedAction } from '@/app/(site)/feeds/_components/use-feed-action';
import { buttonClass } from '@/components/ui/button';
import { CHECK_LABEL } from '@/components/ui/field';
import { ErrorText } from '@/components/ui/notice';
import { z } from 'zod';

/** The fields the feed settings form posts. */
const feedSettingsForm = z.object({
  section_id: z.string().default(''),
  url: z.string().default(''),
  title: z.string().default(''),
});

/** A section a feed can be filed under. */
export interface SectionOption {
  readonly id: number;
  readonly name: string;
}

/** The name, mute switch and section of one row of the feed manager. */
export function FeedSettingsForm({
  id,
  url,
  title,
  muted,
  sectionId,
  sections,
}: Readonly<{
  id: number;
  url: string;
  title: string;
  muted: boolean;
  sectionId: number | null;
  sections: readonly SectionOption[];
}>): ReactElement {
  const { busy, error, run } = useFeedAction();
  const submit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const fields = feedSettingsForm.parse(Object.fromEntries(form));
    const section = fields.section_id;
    const address = fields.url.trim();
    void run(
      async () =>
        editFeed(id, {
          ...(address && address !== url ? { url: address } : {}),
          title: fields.title.trim() || null,
          muted: form.get('muted') === 'on',
          section_id: section || null,
        }),
      'Could not change that feed.',
    );
  };
  return (
    <>
      <form
        className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center"
        onSubmit={submit}
      >
        <input
          name="title"
          type="text"
          aria-label="Name"
          defaultValue={title}
          maxLength={200}
          className="w-full sm:col-span-4"
        />
        <input
          name="url"
          type="url"
          aria-label="Address"
          defaultValue={url}
          maxLength={2048}
          className="w-full"
        />
        <select
          name="section_id"
          aria-label="Section"
          defaultValue={sectionId === null ? '' : String(sectionId)}
        >
          <option value="">No section</option>
          {sections.map((s) => (
            <option key={s.id} value={String(s.id)}>
              {s.name}
            </option>
          ))}
        </select>
        <label className={CHECK_LABEL}>
          <input name="muted" type="checkbox" defaultChecked={muted} /> Muted
        </label>
        <button
          className={buttonClass({ variant: 'outline' })}
          type="submit"
          disabled={busy}
        >
          Save
        </button>
      </form>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </>
  );
}
