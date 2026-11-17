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
} from '@/domain/api/icon-resource';
import type { IconResource } from '@/domain/api/icon-resource';
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
  const name = body['name'];
  const nameText = typeof name === 'string' ? name.trim() : '';
  const nameBad = name !== undefined && nameText === '';
  const nameLong = name !== undefined && nameText.length > MAX_NAME_LENGTH;
  const position = body['position'];
  const positionOk =
    typeof position === 'number' &&
    Number.isInteger(position) &&
    position >= 0 &&
    position <= MAX_POSITION;
  const rawParent = body['parent_id'];
  const parent =
    typeof rawParent === 'string' ? parseFeedId(rawParent) : undefined;
  const parentBad =
    'parent_id' in body && rawParent !== null && parent === undefined;
  const icon = 'icon' in body ? parseIcon(body['icon'], 'icon') : undefined;
  const days = body['auto_mark_read_days'];
  const daysOk = days === null || isAutoMarkReadDays(days);
  const errors: string[] = [
    ...Object.keys(body)
      .filter(
        (key) =>
          ![
            'name',
            'position',
            'parent_id',
            'icon',
            'auto_mark_read_days',
          ].includes(key),
      )
      .map((key) => `${key}: not a member of a section.`),
    ...(name === undefined && required ? ['name: required.'] : []),
    ...(nameBad ? ['name: must be a non-blank string.'] : []),
    ...(!nameBad && nameLong ? ['name: too long.'] : []),
    ...(position !== undefined && !positionOk
      ? [`position: must be a whole number from 0 to ${MAX_POSITION}.`]
      : []),
    ...(parentBad ? ['parent_id: not a section id.'] : []),
    ...(icon && !icon.ok ? icon.errors : []),
    ...('auto_mark_read_days' in body && !daysOk
      ? ['auto_mark_read_days: a whole number from 0 to 365, or null.']
      : []),
  ];
  const changes: SectionChanges = {
    ...(name !== undefined && !nameBad && !nameLong ? { name: nameText } : {}),
    ...(position !== undefined && positionOk ? { position } : {}),
    ...('parent_id' in body && rawParent === null ? { parent_id: null } : {}),
    ...('parent_id' in body && parent !== undefined
      ? { parent_id: parent }
      : {}),
    ...(icon?.ok ? { icon: icon.icon && JSON.stringify(icon.icon) } : {}),
    ...('auto_mark_read_days' in body && daysOk
      ? { auto_mark_read_days: days }
      : {}),
  };
  return errors.length > 0 ? { ok: false, errors } : { ok: true, changes };
}
