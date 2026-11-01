/**
 * @packageDocumentation
 *
 * The listening player as the API shows and accepts it: ids are strings, the
 * rate is bounded, and the queue and history are capped.
 */

import type { PlayerState } from '@/domain/player';
import { parseFeedId } from '@/domain/api/feed-resource';

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

/** A list of article ids, or the field's error. */
function ids(value: unknown, field: string, errors: string[]): number[] {
  if (!Array.isArray(value)) {
    errors.push(`${field}: must be an array of article ids.`);
    return [];
  }
  if (value.length > MAX_PLAYER_ITEMS) {
    errors.push(`${field}: must hold at most ${MAX_PLAYER_ITEMS} ids.`);
    return [];
  }
  const parsed = value.map((v) =>
    typeof v === 'string' ? parseFeedId(v) : undefined,
  );
  if (parsed.some((id) => id === undefined)) {
    errors.push(`${field}: each article id must be a string id.`);
    return [];
  }
  return parsed as number[];
}

/** A PUT body as the player's state, or what is wrong with it. */
export function parsePlayerInput(
  body: Readonly<Record<string, unknown>>,
):
  | { readonly ok: true; readonly value: PlayerState }
  | { readonly ok: false; readonly errors: readonly string[] } {
  const errors: string[] = [];
  const rate = body['rate'];
  if (typeof rate !== 'number' || rate < MIN_RATE || rate > MAX_RATE) {
    errors.push(`rate: must be a number from ${MIN_RATE} to ${MAX_RATE}.`);
  }
  let current: PlayerState['current'] = null;
  const raw = body['current'];
  if (raw !== null && raw !== undefined) {
    const c = raw as Record<string, unknown>;
    const id =
      typeof c['article_id'] === 'string'
        ? parseFeedId(c['article_id'])
        : undefined;
    const position = c['position'];
    if (typeof raw !== 'object' || id === undefined) {
      errors.push(`current.article_id: must be a string article id.`);
    } else if (!Number.isInteger(position) || (position as number) < 0) {
      errors.push(`current.position: must be a whole number of characters.`);
    } else {
      current = { article_id: id, position: position as number };
    }
  }
  const queue = ids(body['queue'], 'queue', errors);
  const history = ids(body['history'], 'history', errors);
  return errors.length
    ? { ok: false, errors }
    : {
        ok: true,
        value: { rate: rate as number, current, queue, history },
      };
}
