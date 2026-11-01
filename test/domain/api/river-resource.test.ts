import { describe, expect, it } from '@jest/globals';

import {
  parseRiverInput,
  parseRiverList,
  riverResource,
} from '@/domain/api/river-resource';

describe('riverResource', () => {
  it('shows the river with its id as a string', () => {
    expect(
      riverResource({
        id: 2,
        user_id: 7,
        river_id: 'feed:4',
        side: 'right',
        position: 1,
        created_at: null,
      }),
    ).toEqual({ id: '2', river_id: 'feed:4', side: 'right', position: 1 });
  });
});

describe('parseRiverInput', () => {
  it('takes a river id, a side and a position', () => {
    expect(
      parseRiverInput({ river_id: 'saves', side: 'left', position: 0 }),
    ).toEqual({
      ok: true,
      value: { river_id: 'saves', side: 'left', position: 0 },
    });
  });

  it('names every member that is wrong', () => {
    expect(
      parseRiverInput({ river_id: 'folder:1', side: 'top', position: 20 }),
    ).toEqual({
      ok: false,
      errors: [
        'river_id: must be all, saves, or feed:, section:, search: or edition: and an id.',
        'side: must be left or right.',
        'position: must be a whole number from 0 to 19.',
      ],
    });
  });

  it('refuses members a river does not have', () => {
    expect(
      parseRiverInput({
        river_id: 'all',
        side: 'left',
        position: 0,
        user_id: 1,
      }),
    ).toEqual({ ok: false, errors: ['user_id: not a member of a river.'] });
  });
});

describe('parseRiverList', () => {
  it('takes a list of rivers', () => {
    const items = [
      { river_id: 'all', side: 'left', position: 0 },
      { river_id: 'saves', side: 'right', position: 0 },
    ];
    expect(parseRiverList({ items })).toEqual({ ok: true, value: items });
  });

  it('refuses two rivers at one place', () => {
    const items = [
      { river_id: 'all', side: 'left', position: 0 },
      { river_id: 'saves', side: 'left', position: 0 },
    ];
    expect(parseRiverList({ items })).toEqual({
      ok: false,
      errors: ['items: two rivers at the same side and position.'],
    });
  });

  it('names the river that is wrong by its place in the list', () => {
    expect(
      parseRiverList({ items: [{ river_id: 'all', side: 'up', position: 0 }] }),
    ).toEqual({ ok: false, errors: ['items[0].side: must be left or right.'] });
  });

  it.each([
    [{}, 'items: must be a list of at most 20 rivers.'],
    [
      { items: Array.from({ length: 21 }, () => ({})) },
      'items: must be a list of at most 20 rivers.',
    ],
    [{ items: [3] }, 'items[0].: must be an object.'],
  ])('refuses %j', (body, error) => {
    expect(parseRiverList(body)).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([error]),
    });
  });
});
