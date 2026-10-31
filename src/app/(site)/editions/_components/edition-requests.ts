/**
 * @packageDocumentation
 *
 * The browser's calls to the custom-editions API. Each resolves when the
 * server did what was asked and throws a `ProblemError` carrying the server's
 * own words when it refused (see `problemText`).
 */

import { ensureOk } from '@/components/api/problem-message';

/** A custom edition's name and rules; null clears the search or tag. */
export interface EditionEdit {
  readonly name: string;
  readonly section_ids: readonly string[];
  readonly query: string | null;
  readonly tag: string | null;
}

/** Add a custom edition (`POST /api/editions`). */
export async function addEdition(edition: EditionEdit): Promise<void> {
  await ensureOk(
    await fetch('/api/editions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(edition),
    }),
  );
}

/** Change the custom edition with this id (`PATCH /api/editions/:id`). */
export async function editEdition(
  id: number,
  edition: EditionEdit,
): Promise<void> {
  await ensureOk(
    await fetch(`/api/editions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(edition),
    }),
  );
}

/** Remove the custom edition with this id (`DELETE /api/editions/:id`). */
export async function removeEdition(id: number): Promise<void> {
  await ensureOk(await fetch(`/api/editions/${id}`, { method: 'DELETE' }));
}
