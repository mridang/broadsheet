'use client';

import type { FormEvent, ReactElement } from 'react';

import { addSection } from '@/app/(site)/feeds/_components/feed-requests';
import type { SectionOption } from '@/app/(site)/feeds/_components/feed-settings-form';
import { useFeedAction } from '@/app/(site)/feeds/_components/use-feed-action';

/**
 * The box on the feed manager for adding a section to file feeds under, at
 * the top level or inside one of the person's sections.
 */
export function AddSectionForm({
  sections,
}: Readonly<{ sections: readonly SectionOption[] }>): ReactElement {
  const { busy, error, run } = useFeedAction();
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '');
    const parent = String(form.get('parent_id') ?? '');
    void run(
      () => addSection(name, parent || undefined),
      'Could not add that section.',
    );
  };
  return (
    <>
      <form className="addform" onSubmit={submit}>
        <input
          name="name"
          type="text"
          placeholder="New section"
          maxLength={200}
          required
        />
        {sections.length ? (
          <select name="parent_id" aria-label="Inside" defaultValue="">
            <option value="">Top level</option>
            {sections.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name}
              </option>
            ))}
          </select>
        ) : null}
        <button className="btn" type="submit" disabled={busy}>
          Add section
        </button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
    </>
  );
}
