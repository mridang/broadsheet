'use client';

import type { FormEvent, ReactElement } from 'react';

import { addSection } from '@/app/(site)/feeds/_components/feed-requests';
import type { SectionOption } from '@/app/(site)/feeds/_components/feed-settings-form';
import { useFeedAction } from '@/app/(site)/feeds/_components/use-feed-action';
import { buttonClass } from '@/components/ui/button';
import { fieldClass } from '@/components/ui/field';
import { ErrorText } from '@/components/ui/notice';

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
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-center"
        onSubmit={submit}
      >
        <input
          name="name"
          type="text"
          placeholder="New section"
          className={fieldClass('w-full sm:flex-1')}
          maxLength={200}
          required
        />
        {sections.length ? (
          <select
            name="parent_id"
            aria-label="Inside"
            defaultValue=""
            className={fieldClass()}
          >
            <option value="">Top level</option>
            {sections.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name}
              </option>
            ))}
          </select>
        ) : null}
        <button className={buttonClass({})} type="submit" disabled={busy}>
          Add section
        </button>
      </form>
      {error ? <ErrorText>{error}</ErrorText> : null}
    </>
  );
}
