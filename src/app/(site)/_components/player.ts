/**
 * @packageDocumentation
 *
 * The listening player in the browser, as NewsBlur's media player keeps it:
 * the playback rate, the story being read and how far in, the stories queued
 * next and the ones already heard. The rules are plain functions; the store
 * below holds the page's one player and keeps the server's copy
 * (`/api/users/self/player`) in step when the person is signed in.
 */

/** Where the person is in their listening; ids are article ids. */
export interface Player {
  readonly rate: number;
  readonly current: { readonly id: number; readonly position: number } | null;
  readonly queue: readonly number[];
  readonly history: readonly number[];
}

/** A player that has heard nothing. */
export const EMPTY: Player = { rate: 1, current: null, queue: [], history: [] };

/** The rates the rate keys step through, as NewsBlur's player offers. */
export const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;

/** The most stories the queue or history keeps (the API's limit). */
export const MAX_ITEMS = 100;

/** The next rate up or down, staying within the ones offered. */
export function stepRate(rate: number, move: 'up' | 'down'): number {
  const at = RATES.findIndex((r) => r >= rate);
  const here = at < 0 ? RATES.length - 1 : at;
  const to = move === 'up' ? here + 1 : here - 1;
  return RATES[Math.min(RATES.length - 1, Math.max(0, to))]!;
}

/** Add a story to the end of the queue, or take it out if it is there. */
export function toggleQueued(player: Player, id: number): Player {
  const queue = player.queue.includes(id)
    ? player.queue.filter((q) => q !== id)
    : [...player.queue, id].slice(0, MAX_ITEMS);
  return { ...player, queue };
}

/** Start a story: it becomes current, leaves the queue and joins the history. */
export function start(player: Player, id: number): Player {
  const position = player.current?.id === id ? player.current.position : 0;
  return {
    ...player,
    current: { id, position },
    queue: player.queue.filter((q) => q !== id),
    history: [id, ...player.history.filter((h) => h !== id)].slice(
      0,
      MAX_ITEMS,
    ),
  };
}

/** Note how far into the current story the voice has got. */
export function progress(player: Player, position: number): Player {
  return player.current
    ? { ...player, current: { ...player.current, position } }
    : player;
}

/**
 * The current story ended: nothing is current and the next queued story, if
 * any, is the one to read.
 */
export function finish(player: Player): { player: Player; next?: number } {
  const [next] = player.queue;
  return {
    player: { ...player, current: null },
    ...(next === undefined ? {} : { next }),
  };
}

/** The player as the API takes it, with string ids. */
export function toResource(player: Player) {
  return {
    rate: player.rate,
    current: player.current && {
      article_id: String(player.current.id),
      position: player.current.position,
    },
    queue: player.queue.map(String),
    history: player.history.map(String),
  };
}

/** The API's player, or the empty one for anything it cannot read. */
export function fromResource(body: unknown): Player {
  if (typeof body !== 'object' || body === null) return EMPTY;
  const b = body as Record<string, unknown>;
  const ids = (v: unknown) =>
    Array.isArray(v)
      ? v.map(Number).filter((n) => Number.isInteger(n) && n > 0)
      : [];
  const c = b['current'] as Record<string, unknown> | null | undefined;
  const id = Number(c?.['article_id']);
  return {
    rate: typeof b['rate'] === 'number' ? b['rate'] : 1,
    current:
      c && Number.isInteger(id) && id > 0
        ? { id, position: Number(c['position']) || 0 }
        : null,
    queue: ids(b['queue']),
    history: ids(b['history']),
  };
}

/** The page's player, shared by every Listen button and the keys. */
let state: Player = EMPTY;
const listeners = new Set<() => void>();
let signedIn = false;
let saving: ReturnType<typeof setTimeout> | undefined;

/** The player as it stands. */
export function getPlayer(): Player {
  return state;
}

/** Be told when the player changes; returns the way to stop. */
export function subscribePlayer(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Change the player, tell the page, and (when signed in) save it shortly
 * after, so a burst of progress becomes one request.
 */
export function updatePlayer(change: (player: Player) => Player): void {
  state = change(state);
  listeners.forEach((listener) => listener());
  if (!signedIn) return;
  clearTimeout(saving);
  saving = setTimeout(() => {
    void fetch('/api/users/self/player', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toResource(state)),
      keepalive: true,
    }).catch(() => undefined);
  }, 1000);
}

/**
 * Load the person's player from the server once; someone signed out keeps a
 * player for this page only.
 */
export async function loadPlayer(): Promise<void> {
  try {
    const res = await fetch('/api/users/self/player');
    if (!res.ok) return;
    signedIn = true;
    state = fromResource(await res.json());
    listeners.forEach((listener) => listener());
  } catch {
    // Offline or signed out: listening still works for this page.
  }
}
