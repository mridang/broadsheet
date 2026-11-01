import { describe, expect, it } from '@jest/globals';

import {
  parseSectionInput,
  sectionResource,
} from '@/domain/api/section-resource';

describe('sectionResource', () => {
  it('shows the id as a string and leaves the owner out', () => {
    expect(
      sectionResource({
        id: 4,
        user_id: 9,
        name: 'Tech',
        position: 2,
        parent_id: null,
        created_at: '2026-01-02 03:04:05',
      }),
    ).toEqual({
      id: '4',
      name: 'Tech',
      position: 2,
      created_at: '2026-01-02T03:04:05Z',
    });
  });

  it('leaves out an unknown creation time', () => {
    expect(
      sectionResource({
        id: 4,
        user_id: 9,
        name: 'Tech',
        position: 0,
        parent_id: null,
        created_at: null,
      }),
    ).toEqual({ id: '4', name: 'Tech', position: 0 });
  });
});

describe('parseSectionInput', () => {
  it.each([
    [{ name: ' Tech ' }, true, { name: 'Tech' }],
    [{ name: 'Tech', position: 3 }, true, { name: 'Tech', position: 3 }],
    [{ position: 0 }, false, { position: 0 }],
    [{}, false, {}],
    [{ parent_id: '3' }, false, { parent_id: 3 }],
    [{ parent_id: null }, false, { parent_id: null }],
  ])('accepts %j (name required: %s)', (body, required, changes) => {
    expect(parseSectionInput(body, required)).toEqual({ ok: true, changes });
  });

  it.each([
    [{}, true, 'name: required.'],
    [{ name: '  ' }, true, 'name: must be a non-blank string.'],
    [{ name: 3 }, false, 'name: must be a non-blank string.'],
    [{ name: 'x'.repeat(201) }, true, 'name: too long.'],
    [
      { name: 'a', position: -1 },
      true,
      'position: must be a whole number from 0 to 10000.',
    ],
    [
      { name: 'a', position: 1.5 },
      true,
      'position: must be a whole number from 0 to 10000.',
    ],
    [{ name: 'a', colour: 'red' }, true, 'colour: not a member of a section.'],
    [{ parent_id: 3 }, false, 'parent_id: not a section id.'],
    [{ parent_id: 'top' }, false, 'parent_id: not a section id.'],
  ])(
    'refuses %j (name required: %s), naming the field',
    (body, required, error) => {
      expect(parseSectionInput(body, required)).toEqual({
        ok: false,
        errors: [error],
      });
    },
  );
});

describe('sectionResource of a nested section', () => {
  it('names its parent as a string', () => {
    expect(
      sectionResource({
        id: 4,
        user_id: 9,
        name: 'AI',
        position: 0,
        parent_id: 2,
        created_at: null,
      }),
    ).toMatchObject({ parent_id: '2' });
  });
});
