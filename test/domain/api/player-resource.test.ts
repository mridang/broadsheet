import { describe, expect, it } from '@jest/globals';

import {
  MAX_PLAYER_ITEMS,
  parsePlayerInput,
  playerResource,
} from '@/domain/api/player-resource';

const body = {
  rate: 1,
  current: { article_id: '3', position: 0 },
  queue: ['4'],
  history: [],
};

describe('parsePlayerInput', () => {
  it('reads a whole player', () => {
    expect(parsePlayerInput(body)).toEqual({
      ok: true,
      value: {
        rate: 1,
        current: { article_id: 3, position: 0 },
        queue: [4],
        history: [],
      },
    });
  });

  it('takes no current story as null', () => {
    const out = parsePlayerInput({ ...body, current: null });
    expect(out.ok && out.value.current).toBeNull();
  });

  it('refuses a player that leaves current out', () => {
    const without = {
      rate: body.rate,
      queue: body.queue,
      history: body.history,
    };
    const out = parsePlayerInput(without);
    expect(out.ok ? [] : out.errors).toEqual([
      'current: required, an object or null.',
    ]);
  });

  it.each([
    [{ rate: 0.1 }, 'rate: must be a number from 0.5 to 3.'],
    [{ rate: '1' }, 'rate: must be a number from 0.5 to 3.'],
    [
      { current: { article_id: 3, position: 0 } },
      'current.article_id: must be a string article id.',
    ],
    [
      { current: { article_id: '3', position: -1 } },
      'current.position: must be a whole number of characters.',
    ],
    [{ queue: 'x' }, 'queue: must be an array of article ids.'],
    [{ history: [5] }, 'history: each article id must be a string id.'],
    [
      { queue: Array.from({ length: MAX_PLAYER_ITEMS + 1 }, () => '1') },
      `queue: must hold at most ${MAX_PLAYER_ITEMS} ids.`,
    ],
  ])('refuses %j', (change, error) => {
    expect(parsePlayerInput({ ...body, ...change })).toEqual({
      ok: false,
      errors: [error],
    });
  });
});

describe('playerResource', () => {
  it('shows ids as strings', () => {
    expect(
      playerResource({
        rate: 2,
        current: { article_id: 3, position: 9 },
        queue: [4],
        history: [5],
      }),
    ).toEqual({
      rate: 2,
      current: { article_id: '3', position: 9 },
      queue: ['4'],
      history: ['5'],
    });
  });

  it('shows no current story as null', () => {
    expect(
      playerResource({ rate: 1, current: null, queue: [], history: [] })
        .current,
    ).toBeNull();
  });
});
