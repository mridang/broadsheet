/**
 * @packageDocumentation
 *
 * The listening player as the API shows and accepts it: ids are strings, the
 * rate is bounded, and the queue and history are capped.
 */

import { parseFeedId } from '@/domain/api/feed-resource';
import { isObject } from '@/lib/core/api';
import type { PlayerState } from '@/domain/player';

/** The slowest and fastest a voice may read. */
export const MIN_RATE = 0.5;
export const MAX_RATE = 3;

/** The most stories the queue or the history keeps. */
export const MAX_PLAYER_ITEMS = 100;

/** The player as the API shows it. */
export interface PlayerResource {
  readonly rate: number;
  readonly current: {
    readonly article_id: string;
    readonly position: number;
  } | null;
  readonly queue: readonly string[];
  readonly history: readonly string[];
}

/** The player's state as the API shows it. */
export function playerResource(state: PlayerState): PlayerResource {
  return {
    rate: state.rate,
    current: state.current && {
      article_id: String(state.current.article_id),
      position: state.current.position,
    },
    queue: state.queue.map(String),
    history: state.history.map(String),
  };
}

/** A list of article ids and the field's errors. */
interface IdList {
  readonly ids: number[];
  readonly errors: string[];
}

/** A list of article ids, or the field's error. */
function ids(value: unknown, field: string): IdList {
  if (!Array.isArray(value)) {
    return {
      ids: [],
      errors: [`${field}: must be an array of article ids.`],
    };
  }
  if (value.length > MAX_PLAYER_ITEMS) {
    return {
      ids: [],
      errors: [`${field}: must hold at most ${MAX_PLAYER_ITEMS} ids.`],
    };
  }
  const parsed = value.map((v) =>
    typeof v === 'string' ? parseFeedId(v) : undefined,
  );
  if (!parsed.every((v) => v !== undefined)) {
    return {
      ids: [],
      errors: [`${field}: each article id must be a string id.`],
    };
  }
  return { ids: parsed, errors: [] };
}

/** A PUT body as the player's state, or what is wrong with it. */
export function parsePlayerInput(
  body: Readonly<Record<string, unknown>>,
):
  | { readonly ok: true; readonly value: PlayerState }
  | { readonly ok: false; readonly errors: readonly string[] } {
  const rate = body['rate'];
  const raw = body['current'];
  const c = isObject(raw) ? raw : undefined;
  const id =
    typeof c?.['article_id'] === 'string'
      ? parseFeedId(c['article_id'])
      : undefined;
  const position = c?.['position'];
  const given = raw !== undefined && raw !== null;
  const objectBad = given && (typeof raw !== 'object' || id === undefined);
  const place =
    typeof position === 'number' && Number.isInteger(position) && position >= 0
      ? position
      : undefined;
  const positionBad = given && !objectBad && place === undefined;
  const currentFine = given && !objectBad && !positionBad;
  const current: PlayerState['current'] =
    currentFine && id !== undefined && place !== undefined
      ? { article_id: id, position: place }
      : null;
  const queueIds = ids(body['queue'], 'queue');
  const historyIds = ids(body['history'], 'history');
  const queue = queueIds.ids;
  const history = historyIds.ids;
  const speed =
    typeof rate === 'number' && rate >= MIN_RATE && rate <= MAX_RATE
      ? rate
      : undefined;
  const errors: string[] = [
    ...(speed === undefined
      ? [`rate: must be a number from ${MIN_RATE} to ${MAX_RATE}.`]
      : []),
    ...(raw === undefined ? ['current: required, an object or null.'] : []),
    ...(objectBad ? ['current.article_id: must be a string article id.'] : []),
    ...(positionBad
      ? ['current.position: must be a whole number of characters.']
      : []),
    ...queueIds.errors,
    ...historyIds.errors,
  ];
  return errors.length > 0 || speed === undefined
    ? { ok: false, errors }
    : {
        ok: true,
        value: { rate: speed, current, queue, history },
      };
}
