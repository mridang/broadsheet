import { afterEach, describe, expect, it, jest } from '@jest/globals';

import {
  EMPTY,
  MAX_ITEMS,
  RATES,
  finish,
  fromResource,
  getPlayer,
  loadPlayer,
  progress,
  start,
  stepRate,
  subscribePlayer,
  toResource,
  toggleQueued,
  updatePlayer,
} from '@/app/(site)/_components/player';

const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
  jest.useRealTimers();
});

describe('stepRate', () => {
  it('steps up and down through the rates offered', () => {
    expect(stepRate(1, 'up')).toBe(1.25);
    expect(stepRate(1, 'down')).toBe(0.75);
  });

  it('stays within the slowest and fastest', () => {
    expect(stepRate(RATES[0], 'down')).toBe(RATES[0]);
    expect(stepRate(9, 'up')).toBe(RATES.at(-1));
  });
});

describe('toggleQueued', () => {
  it('adds a story to the end, and takes it out again', () => {
    const queued = toggleQueued({ ...EMPTY, queue: [1] }, 2);
    expect(queued.queue).toEqual([1, 2]);
    expect(toggleQueued(queued, 1).queue).toEqual([2]);
  });

  it('keeps no more than the API allows', () => {
    const full = {
      ...EMPTY,
      queue: Array.from({ length: MAX_ITEMS }, (_, i) => i + 1),
    };
    expect(toggleQueued(full, 999).queue).toHaveLength(MAX_ITEMS);
  });
});

describe('start', () => {
  it('makes the story current, out of the queue and first in the history', () => {
    expect(start({ ...EMPTY, queue: [3, 4], history: [3, 1] }, 3)).toEqual({
      rate: 1,
      current: { id: 3, position: 0 },
      queue: [4],
      history: [3, 1],
    });
  });

  it('resumes the current story where it was', () => {
    const p = { ...EMPTY, current: { id: 3, position: 40 } };
    expect(start(p, 3).current).toEqual({ id: 3, position: 40 });
    expect(start(p, 4).current).toEqual({ id: 4, position: 0 });
  });
});

describe('progress', () => {
  it('notes the position of the current story', () => {
    const p = start(EMPTY, 3);
    expect(progress(p, 12).current).toEqual({ id: 3, position: 12 });
  });

  it('does nothing with no story current', () => {
    expect(progress(EMPTY, 12)).toBe(EMPTY);
  });
});

describe('finish', () => {
  it('clears the current story and names the next queued one', () => {
    const p = { ...start(EMPTY, 3), queue: [5, 6] };
    expect(finish(p)).toEqual({ player: { ...p, current: null }, next: 5 });
  });

  it('names no next story when the queue is empty', () => {
    expect(finish(start(EMPTY, 3))).not.toHaveProperty('next');
  });
});

describe('toResource and fromResource', () => {
  const p = {
    rate: 1.5,
    current: { id: 3, position: 9 },
    queue: [4],
    history: [3],
  };

  it('round-trip the player through the API’s shape', () => {
    expect(toResource(p)).toEqual({
      rate: 1.5,
      current: { article_id: '3', position: 9 },
      queue: ['4'],
      history: ['3'],
    });
    expect(fromResource(toResource(p))).toEqual(p);
  });

  it('reads anything unreadable as the empty player', () => {
    expect(fromResource(null)).toEqual(EMPTY);
    expect(
      fromResource({ queue: ['x', '2'], current: { article_id: 'y' } }),
    ).toEqual({
      ...EMPTY,
      queue: [2],
    });
  });
});

describe('the page’s player', () => {
  it('tells listeners of a change', () => {
    const heard = jest.fn();
    const stop = subscribePlayer(heard);
    updatePlayer((p) => ({ ...p, rate: 2 }));
    stop();
    expect(heard).toHaveBeenCalledTimes(1);
    expect(getPlayer().rate).toBe(2);
  });

  it('keeps a signed-out person’s player on the page only', async () => {
    const fetch = jest.fn(async () => new Response(null, { status: 401 }));
    globalThis.fetch = fetch as never;
    await loadPlayer();
    jest.useFakeTimers();
    updatePlayer((p) => ({ ...p, rate: 1 }));
    jest.runAllTimers();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('loads a signed-in person’s player and saves changes once, shortly after', async () => {
    const fetch = jest.fn<
      (url: string, init?: RequestInit) => Promise<Response>
    >(async () =>
      Response.json({ rate: 1.25, current: null, queue: ['7'], history: [] }),
    );
    globalThis.fetch = fetch as never;
    await loadPlayer();
    expect(getPlayer()).toEqual({ ...EMPTY, rate: 1.25, queue: [7] });
    jest.useFakeTimers();
    updatePlayer((p) => progress(start(p, 7), 1));
    updatePlayer((p) => progress(p, 2));
    jest.runAllTimers();
    const puts = fetch.mock.calls.filter(([, init]) => init?.method === 'PUT');
    expect(puts).toHaveLength(1);
    expect(JSON.parse(String(puts[0]?.[1]?.body))).toEqual({
      rate: 1.25,
      current: { article_id: '7', position: 2 },
      queue: [],
      history: ['7'],
    });
  });

  it('keeps working when the server cannot be reached', async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new Error('offline');
    }) as never;
    await expect(loadPlayer()).resolves.toBeUndefined();
  });
});
