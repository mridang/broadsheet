/**
 * @packageDocumentation
 *
 * Dashboard rivers on the wire: the representation
 * `/api/users/self/rivers` sends, and checking the bodies that pin one or
 * replace them all.
 */

import { rfc3339 } from '@/domain/api/feed-resource';
import { isMember } from '@/domain/members';
import { isObject } from '@/lib/core/api';
import { MAX_RIVERS, parseRiverId, RIVER_SIDES } from '@/domain/rivers';
import type { River, RiverInput, RiverSide } from '@/domain/rivers';

/** A river as the API shows it. */
export interface RiverResource {
  readonly id: string;
  readonly river_id: string;
  readonly side: RiverSide;
  readonly position: number;
  readonly created_at?: string;
}

/** The API's view of a pinned river. */
export function riverResource(river: Readonly<River>): RiverResource {
  const created = river.created_at ? rfc3339(river.created_at) : undefined;
  return {
    id: String(river.id),
    river_id: river.river_id,
    side: river.side,
    position: river.position,
    ...(created ? { created_at: created } : {}),
  };
}

/** A checked river body, or what was wrong with it. */
export type RiverCheck<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly string[] };

/** One checked river, when it was valid, and its errors. */
interface CheckedRiver {
  readonly river?: RiverInput;
  readonly errors: string[];
}

/** Whether a value is a whole number below {@link MAX_RIVERS}. */
const isPlace = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value < MAX_RIVERS;

/**
 * Check one river, its errors prefixed with `at`: `river_id` one a river can
 * list (`all`, `saves`, `feed:{id}`, `section:{id}`, `search:{id}`,
 * `edition:{id}`), `side` left or right, `position` a whole number below
 * {@link MAX_RIVERS}. Other members are refused.
 */
function checkRiver(body: unknown, at: string): CheckedRiver {
  if (!isObject(body)) {
    return { errors: [`${at || 'river'}: must be an object.`] };
  }
  const value = body;
  const { river_id: riverId, side, position } = value;
  const place = isPlace(position) ? position : undefined;
  const id =
    typeof riverId === 'string' && parseRiverId(riverId) ? riverId : undefined;
  const chosenSide = isMember(RIVER_SIDES, side) ? side : undefined;
  const errors = [
    ...Object.keys(value)
      .filter((key) => !['river_id', 'side', 'position'].includes(key))
      .map((key) => `${at}${key}: not a member of a river.`),
    ...(id === undefined
      ? [
          `${at}river_id: must be all, saves, or feed:, section:, search: or edition: and an id.`,
        ]
      : []),
    ...(chosenSide === undefined ? [`${at}side: must be left or right.`] : []),
    ...(place === undefined
      ? [`${at}position: must be a whole number from 0 to ${MAX_RIVERS - 1}.`]
      : []),
  ];
  if (errors.length > 0 || id === undefined) {
    return { errors };
  }
  if (chosenSide === undefined || place === undefined) {
    return { errors };
  }
  return {
    river: { river_id: id, side: chosenSide, position: place },
    errors,
  };
}

/** Check the body that pins one river. */
export function parseRiverInput(
  body: Readonly<Record<string, unknown>>,
): RiverCheck<RiverInput> {
  const { river, errors } = checkRiver(body, '');
  return river ? { ok: true, value: river } : { ok: false, errors };
}

/**
 * Check the body that replaces every river: `{items: [...]}`, at most
 * {@link MAX_RIVERS}, no two at the same place.
 */
export function parseRiverList(
  body: Readonly<Record<string, unknown>>,
): RiverCheck<RiverInput[]> {
  const { items } = body;
  const keyErrors = Object.keys(body)
    .filter((key) => key !== 'items')
    .map((key) => `${key}: not a member of a river list.`);
  if (!Array.isArray(items) || items.length > MAX_RIVERS) {
    return {
      ok: false,
      errors: [
        ...keyErrors,
        `items: must be a list of at most ${MAX_RIVERS} rivers.`,
      ],
    };
  }
  const checked = items.map((item, index) =>
    checkRiver(item, `items[${index}].`),
  );
  const list = checked.map((c) => c.river);
  const places = new Set(list.map((r) => r && `${r.side}:${r.position}`));
  const errors = [...keyErrors, ...checked.flatMap((c) => c.errors)];
  const withPlaces =
    errors.length === 0 && places.size < list.length
      ? [...errors, 'items: two rivers at the same side and position.']
      : errors;
  return withPlaces.length > 0
    ? { ok: false, errors: withPlaces }
    : { ok: true, value: checked.flatMap((c) => c.river ?? []) };
}
