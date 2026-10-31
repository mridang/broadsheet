'use client';

import type { FormEvent, ReactElement } from 'react';

import { editFeed } from '@/app/(site)/feeds/_components/feed-requests';
import { useFeedAction } from '@/app/(site)/feeds/_components/use-feed-action';

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
      <form className="feedsettings" onSubmit={submit}>
        <input
          name="title"
          type="text"
          aria-label="Name"
          defaultValue={title}
          maxLength={200}
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
        <label>
          <input name="muted" type="checkbox" defaultChecked={muted} /> Muted
        </label>
        <button className="btn ghost" type="submit" disabled={busy}>
          Save
        </button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
    </>
  );
}
