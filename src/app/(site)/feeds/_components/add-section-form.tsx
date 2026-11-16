'use client';

import type { SubmitEvent, ReactElement } from 'react';

import { addSection } from '@/app/(site)/feeds/_components/feed-requests';
import type { SectionOption } from '@/app/(site)/feeds/_components/feed-settings-form';
import { useFeedAction } from '@/app/(site)/feeds/_components/use-feed-action';
import { buttonClass } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/notice';
import { z } from 'zod';

/** The fields the add-section form posts. */
const addSectionForm = z.object({
  name: z.string().default(''),
  parent_id: z.string().default(''),
});

/**
 * The box on the feed manager for adding a section to file feeds under, at
 * the top level or inside one of the person's sections.
 */
export function AddSectionForm({
  sections,
}: Readonly<{ sections: readonly SectionOption[] }>): ReactElement {
  const { busy, error, run } = useFeedAction();
  const submit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const { name, parent_id: parent } = addSectionForm.parse(
      Object.fromEntries(form),
    );
    void run(
      async () => addSection(name, parent || undefined),
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
          className="w-full sm:flex-1"
          maxLength={200}
          required
        />
        {sections.length > 0 ? (
          <select name="parent_id" aria-label="Inside" defaultValue="">
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
