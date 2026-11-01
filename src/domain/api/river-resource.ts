/**
 * @packageDocumentation
 *
 * Dashboard rivers on the wire: the representation
 * `/api/users/self/rivers` sends, and checking the bodies that pin one or
 * replace them all.
 */

import { rfc3339 } from '@/domain/api/feed-resource';
import {
  MAX_RIVERS,
  parseRiverId,
  RIVER_SIDES,
  type River,
  type RiverInput,
  type RiverSide,
} from '@/domain/rivers';

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

/**
 * Check one river, its errors prefixed with `at`: `river_id` one a river can
 * list (`all`, `saves`, `feed:{id}`, `section:{id}`, `search:{id}`,
 * `edition:{id}`), `side` left or right, `position` a whole number below
 * {@link MAX_RIVERS}. Other members are refused.
 */
function checkRiver(
  body: unknown,
  at: string,
  errors: string[],
): RiverInput | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    errors.push(`${at || 'river'}: must be an object.`);
    return undefined;
  }
  const value = body as Record<string, unknown>;
  const before = errors.length;
  for (const key of Object.keys(value)) {
    if (!['river_id', 'side', 'position'].includes(key)) {
      errors.push(`${at}${key}: not a member of a river.`);
    }
  }
  const { river_id: riverId, side, position } = value;
  if (typeof riverId !== 'string' || !parseRiverId(riverId)) {
    errors.push(
      `${at}river_id: must be all, saves, or feed:, section:, search: or edition: and an id.`,
    );
  }
  if (!(RIVER_SIDES as readonly unknown[]).includes(side)) {
    errors.push(`${at}side: must be left or right.`);
  }
  if (
    typeof position !== 'number' ||
    !Number.isInteger(position) ||
    position < 0 ||
    position >= MAX_RIVERS
  ) {
    errors.push(
      `${at}position: must be a whole number from 0 to ${MAX_RIVERS - 1}.`,
    );
  }
  return errors.length > before
    ? undefined
    : {
        river_id: riverId as string,
        side: side as RiverSide,
        position: position as number,
      };
}

/** Check the body that pins one river. */
export function parseRiverInput(
  body: Readonly<Record<string, unknown>>,
): RiverCheck<RiverInput> {
  const errors: string[] = [];
  const river = checkRiver(body, '', errors);
  return river ? { ok: true, value: river } : { ok: false, errors };
}

/**
 * Check the body that replaces every river: `{items: [...]}`, at most
 * {@link MAX_RIVERS}, no two at the same place.
 */
export function parseRiverList(
  body: Readonly<Record<string, unknown>>,
): RiverCheck<RiverInput[]> {
  const errors = Object.keys(body)
    .filter((key) => key !== 'items')
    .map((key) => `${key}: not a member of a river list.`);
  const { items } = body;
  if (!Array.isArray(items) || items.length > MAX_RIVERS) {
    errors.push(`items: must be a list of at most ${MAX_RIVERS} rivers.`);
    return { ok: false, errors };
  }
  const list = items.map((item, i) => checkRiver(item, `items[${i}].`, errors));
  const places = new Set(list.map((r) => r && `${r.side}:${r.position}`));
  if (!errors.length && places.size < list.length) {
    errors.push('items: two rivers at the same side and position.');
  }
  return errors.length
    ? { ok: false, errors }
    : { ok: true, value: list as RiverInput[] };
}
