'use client';

import type { FormEvent, ReactElement } from 'react';

import { useApiAction } from '@/components/api/use-api-action';
import {
  addEdition,
  editEdition,
  type EditionEdit,
} from '@/app/(site)/editions/_components/edition-requests';

/** A section an edition may print. */
export interface SectionOption {
  readonly id: number;
  readonly name: string;
}

/** The form's starting values; with an `id` it edits that edition. */
export interface EditionDraft {
  readonly id?: number;
  readonly name: string;
  readonly section_ids: readonly number[];
  readonly query: string;
  readonly tag: string;
}

/** The empty draft a new edition starts from. */
export const BLANK: EditionDraft = {
  name: '',
  section_ids: [],
  query: '',
  tag: '',
};

/** What the form holds, as the API takes it. */
export function editionOf(data: FormData): EditionEdit {
  const text = (key: string) => String(data.get(key) ?? '').trim();
  return {
    name: text('name'),
    section_ids: data.getAll('section').map(String),
    query: text('query') || null,
    tag: text('tag') || null,
  };
}

/**
 * Add a custom edition, or change one: its name, the sections it prints (none
 * ticked prints every feed), a search its stories must match and a tag they
 * must be saved under.
 */
export function EditionForm({
  draft,
  sections,
}: Readonly<{
  draft: EditionDraft;
  sections: readonly SectionOption[];
}>): ReactElement {
  const { busy, error, run } = useApiAction(() => window.location.reload());
  const { id } = draft;
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const edition = editionOf(new FormData(event.currentTarget));
    void run(
      () => (id === undefined ? addEdition(edition) : editEdition(id, edition)),
      'Could not save that edition.',
    );
  };
  return (
    <form className="addform" onSubmit={submit}>
      <input
        name="name"
        type="text"
        placeholder="Name, such as Weekend"
        aria-label="Name"
        defaultValue={draft.name}
        maxLength={200}
        required
      />
      {sections.length ? (
        <fieldset>
          <legend>Sections (none for every feed)</legend>
          {sections.map((s) => (
            <label key={s.id}>
              <input
                type="checkbox"
                name="section"
                value={s.id}
                defaultChecked={draft.section_ids.includes(s.id)}
              />{' '}
              {s.name}
            </label>
          ))}
        </fieldset>
      ) : null}
      <input
        name="query"
        type="search"
        placeholder="Only stories matching"
        aria-label="Search"
        defaultValue={draft.query}
        maxLength={200}
      />
      <input
        name="tag"
        type="text"
        placeholder="Only stories saved under tag"
        aria-label="Tag"
        defaultValue={draft.tag}
        maxLength={50}
      />
      <button className="btn" type="submit" disabled={busy}>
        {id === undefined ? 'Add edition' : 'Save'}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}
