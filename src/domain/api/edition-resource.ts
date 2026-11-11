/**
 * @packageDocumentation
 *
 * Custom editions on the wire: the representation `/api/editions` sends, and
 * checking the bodies a client posts to add or change one.
 */

import { MAX_QUERY_LENGTH } from '@/domain/api/article-resource';
import {
  MAX_NAME_LENGTH,
  parseFeedId,
  rfc3339,
} from '@/domain/api/feed-resource';
import type { CustomEdition, EditionChanges } from '@/domain/repository';

/** Longest tag an edition may pick by, in characters. */
export const MAX_TAG_LENGTH = 50;

/** Most sections one edition may print. */
const MAX_SECTIONS = 50;

/** A custom edition as the API shows it. Absent members are unknown. */
export interface EditionResource {
  readonly id: string;
  readonly name: string;
  readonly section_ids: readonly string[];
  readonly query?: string;
  readonly tag?: string;
  readonly created_at?: string;
}

/** The API's view of a stored custom edition. */
export function editionResource(
  edition: Readonly<CustomEdition>,
): EditionResource {
  const created = edition.created_at ? rfc3339(edition.created_at) : undefined;
  return {
    id: String(edition.id),
    name: edition.name,
    section_ids: edition.section_ids.map(String),
    ...(edition.query ? { query: edition.query } : {}),
    ...(edition.tag ? { tag: edition.tag } : {}),
    ...(created ? { created_at: created } : {}),
  };
}

/** A checked edition body, or what was wrong with it. */
export type EditionInput =
  | { readonly ok: true; readonly changes: EditionChanges }
  | { readonly ok: false; readonly errors: readonly string[] };

/** The members an edition body may carry. */
const MEMBERS = new Set(['name', 'section_ids', 'query', 'tag']);

/**
 * A rule that is text or null: null or blank clears it. Pushes what is wrong
 * to `errors` and answers undefined when the member was not sent.
 */
function optionalText(
  key: string,
  value: unknown,
  max: number,
  errors: string[],
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') {
    errors.push(`${key}: must be a string or null.`);
    return undefined;
  }
  if (value.trim().length > max) {
    errors.push(`${key}: too long.`);
    return undefined;
  }
  return value.trim() || null;
}

/**
 * Check an edition body: `name` a non-blank string, `section_ids` a list of
 * section ids, `query` a search and `tag` a save tag (each a string, or null to
 * clear it). `POST` needs the name (`required`); `PATCH` takes any. Other
 * members are refused. Whether the sections are the caller's is checked by
 * the controller.
 */
export function parseEditionInput(
  body: Readonly<Record<string, unknown>>,
  required: boolean,
): EditionInput {
  const errors: string[] = [];
  const changes: { -readonly [K in keyof EditionChanges]: EditionChanges[K] } =
    {};
  for (const key of Object.keys(body)) {
    if (!MEMBERS.has(key)) errors.push(`${key}: not a member of an edition.`);
  }
  const name = body['name'];
  if (name === undefined) {
    if (required) errors.push('name: required.');
  } else if (typeof name !== 'string' || !name.trim()) {
    errors.push('name: must be a non-blank string.');
  } else if (name.trim().length > MAX_NAME_LENGTH) {
    errors.push('name: too long.');
  } else changes.name = name.trim();
  const sections = body['section_ids'];
  if (sections !== undefined) {
    const ids = Array.isArray(sections)
      ? sections.map((id) =>
          typeof id === 'string' ? parseFeedId(id) : undefined,
        )
      : [];
    if (
      !Array.isArray(sections) ||
      sections.length > MAX_SECTIONS ||
      ids.includes(undefined)
    ) {
      errors.push(
        `section_ids: must be a list of at most ${MAX_SECTIONS} section ids.`,
      );
    } else changes.section_ids = [...new Set(ids as number[])];
  }
  const query = optionalText('query', body['query'], MAX_QUERY_LENGTH, errors);
  if (query !== undefined) changes.query = query;
  const tag = optionalText('tag', body['tag'], MAX_TAG_LENGTH, errors);
  if (tag !== undefined) changes.tag = tag;
  return errors.length > 0 ? { ok: false, errors } : { ok: true, changes };
}
