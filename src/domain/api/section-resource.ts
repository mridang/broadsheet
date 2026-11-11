/**
 * @packageDocumentation
 *
 * Sections on the wire: the representation `/api/sections` sends, and
 * checking the bodies a client posts to add or change one.
 */

import {
  MAX_NAME_LENGTH,
  parseFeedId,
  rfc3339,
} from '@/domain/api/feed-resource';
import {
  iconResource,
  isAutoMarkReadDays,
  parseIcon,
  type IconResource,
} from '@/domain/api/icon-resource';
import type { Section, SectionChanges } from '@/domain/repository';

/** Highest position a section may take. */
const MAX_POSITION = 10_000;

/** A section as the API shows it. Absent members are unknown, never null. */
export interface SectionResource {
  readonly id: string;
  readonly name: string;
  readonly position: number;
  /** The section this one nests under; absent at the top level. */
  readonly parent_id?: string;
  readonly icon?: IconResource;
  /** Days until its feeds' stories count as read; absent inherits, 0 never. */
  readonly auto_mark_read_days?: number;
  readonly created_at?: string;
}

/** The API's view of a stored section. */
export function sectionResource(section: Readonly<Section>): SectionResource {
  const created = section.created_at ? rfc3339(section.created_at) : undefined;
  return {
    id: String(section.id),
    name: section.name,
    position: section.position,
    ...(section.parent_id === null
      ? {}
      : { parent_id: String(section.parent_id) }),
    ...(iconResource(section.icon) ? { icon: iconResource(section.icon) } : {}),
    ...(section.auto_mark_read_days === null
      ? {}
      : { auto_mark_read_days: section.auto_mark_read_days }),
    ...(created ? { created_at: created } : {}),
  };
}

/** A checked section body, or what was wrong with it. */
export type SectionInput =
  | { readonly ok: true; readonly changes: SectionChanges }
  | { readonly ok: false; readonly errors: readonly string[] };

/**
 * Check a section body: `name` a non-blank string, `position` a whole number
 * from 0, `parent_id` a section id or null for the top level. `POST` needs the name (`required`); `PATCH` takes either. Other
 * members are refused.
 */
export function parseSectionInput(
  body: Readonly<Record<string, unknown>>,
  required: boolean,
): SectionInput {
  const errors: string[] = [];
  const changes: { -readonly [K in keyof SectionChanges]: SectionChanges[K] } =
    {};
  for (const key of Object.keys(body)) {
    if (
      ![
        'name',
        'position',
        'parent_id',
        'icon',
        'auto_mark_read_days',
      ].includes(key)
    ) {
      errors.push(`${key}: not a member of a section.`);
    }
  }
  const name = body['name'];
  if (name === undefined) {
    if (required) errors.push('name: required.');
  } else if (typeof name !== 'string' || !name.trim()) {
    errors.push('name: must be a non-blank string.');
  } else if (name.trim().length > MAX_NAME_LENGTH) {
    errors.push('name: too long.');
  } else changes.name = name.trim();
  const position = body['position'];
  if (position !== undefined) {
    if (
      typeof position === 'number' &&
      Number.isInteger(position) &&
      position >= 0 &&
      position <= MAX_POSITION
    ) {
      changes.position = position;
    } else
      errors.push(
        `position: must be a whole number from 0 to ${MAX_POSITION}.`,
      );
  }
  if ('parent_id' in body) {
    const raw = body['parent_id'];
    const id = typeof raw === 'string' ? parseFeedId(raw) : undefined;
    if (raw === null) changes.parent_id = null;
    else if (id === undefined) errors.push('parent_id: not a section id.');
    else changes.parent_id = id;
  }
  if ('icon' in body) {
    const icon = parseIcon(body['icon'], 'icon');
    if (icon.ok) {
      changes.icon = icon.icon && JSON.stringify(icon.icon);
    } else {
      errors.push(...icon.errors);
    }
  }
  if ('auto_mark_read_days' in body) {
    const days = body['auto_mark_read_days'];
    if (days === null || isAutoMarkReadDays(days)) {
      changes.auto_mark_read_days = days;
    } else {
      errors.push(
        'auto_mark_read_days: a whole number from 0 to 365, or null.',
      );
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, changes };
}
