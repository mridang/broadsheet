'use client';

import type { FormEvent, ReactElement } from 'react';

import { editFeed } from '@/app/(site)/feeds/_components/feed-requests';
import { useFeedAction } from '@/app/(site)/feeds/_components/use-feed-action';
import { buttonClass } from '@/components/ui/button';
import { CHECK_LABEL, CHECKBOX, fieldClass } from '@/components/ui/field';
import { ErrorText } from '@/components/ui/notice';

/** A section a feed can be filed under. */
export interface SectionOption {
  readonly id: number;
  readonly name: string;
}

/** The name, mute switch and section of one row of the feed manager. */
export function FeedSettingsForm({
  id,
  title,
  muted,
  sectionId,
  sections,
}: Readonly<{
  id: number;
  title: string;
  muted: boolean;
  sectionId: number | null;
  sections: readonly SectionOption[];
}>): ReactElement {
  const { busy, error, run } = useFeedAction();
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const section = String(form.get('section_id') ?? '');
    void run(
      () =>
        editFeed(id, {
          title: String(form.get('title') ?? '').trim() || null,
          muted: form.get('muted') === 'on',
          section_id: section || null,
        }),
      'Could not change that feed.',
    );
  };
  return (
    <>
      <form className="flex flex-wrap items-center gap-2" onSubmit={submit}>
        <input
          name="title"
          type="text"
          aria-label="Name"
          defaultValue={title}
          maxLength={200}
          className={fieldClass('w-full sm:w-auto sm:flex-1')}
        />
        <select
          name="section_id"
          aria-label="Section"
          className={fieldClass()}
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
          <input
            name="muted"
            type="checkbox"
            defaultChecked={muted}
            className={CHECKBOX}
          />{' '}
          Muted
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
