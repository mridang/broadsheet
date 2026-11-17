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

/** A text member that may be null: what it says, and what was wrong. */
interface OptionalText {
  /** The text, null to clear it; absent when not sent or not valid. */
  readonly value?: string | null;
  readonly errors: string[];
}

/**
 * A rule that is text or null: null or blank clears it. Answers what is wrong
 * in `errors` and no `value` when the member was not sent.
 */
function optionalText(key: string, value: unknown, max: number): OptionalText {
  if (value === undefined) {
    return { errors: [] };
  }
  if (value === null) {
    return { value: null, errors: [] };
  }
  if (typeof value !== 'string') {
    return { errors: [`${key}: must be a string or null.`] };
  }
  if (value.trim().length > max) {
    return { errors: [`${key}: too long.`] };
  }
  return { value: value.trim() || null, errors: [] };
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
  const name = body['name'];
  const nameText = typeof name === 'string' ? name.trim() : '';
  const nameBad = name !== undefined && nameText === '';
  const nameLong = name !== undefined && nameText.length > MAX_NAME_LENGTH;
  const sections = body['section_ids'];
  const ids = Array.isArray(sections)
    ? sections.map((id) =>
        typeof id === 'string' ? parseFeedId(id) : undefined,
      )
    : [];
  const sectionsBad =
    sections !== undefined &&
    (!Array.isArray(sections) ||
      sections.length > MAX_SECTIONS ||
      ids.includes(undefined));
  const query = optionalText('query', body['query'], MAX_QUERY_LENGTH);
  const tag = optionalText('tag', body['tag'], MAX_TAG_LENGTH);
  const errors: string[] = [
    ...Object.keys(body)
      .filter((key) => !MEMBERS.has(key))
      .map((key) => `${key}: not a member of an edition.`),
    ...(name === undefined && required ? ['name: required.'] : []),
    ...(nameBad ? ['name: must be a non-blank string.'] : []),
    ...(!nameBad && nameLong ? ['name: too long.'] : []),
    ...(sectionsBad
      ? [`section_ids: must be a list of at most ${MAX_SECTIONS} section ids.`]
      : []),
    ...query.errors,
    ...tag.errors,
  ];
  const changes: EditionChanges = {
    ...(name !== undefined && !nameBad && !nameLong ? { name: nameText } : {}),
    ...(sections !== undefined && !sectionsBad
      ? { section_ids: [...new Set(ids as number[])] }
      : {}),
    ...(query.value === undefined ? {} : { query: query.value }),
    ...(tag.value === undefined ? {} : { tag: tag.value }),
  };
  return errors.length > 0 ? { ok: false, errors } : { ok: true, changes };
}
