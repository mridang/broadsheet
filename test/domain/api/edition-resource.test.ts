import { describe, expect, it } from '@jest/globals';

import {
  editionResource,
  parseEditionInput,
} from '@/domain/api/edition-resource';

describe('editionResource', () => {
  it('shows ids as strings and leaves out rules that are not set', () => {
    expect(
      editionResource({
        id: 4,
        user_id: 7,
        name: 'Weekend',
        section_ids: [2, 3],
        query: null,
        tag: 'long',
        created_at: '2026-11-01 06:00:00',
      }),
    ).toEqual({
      id: '4',
      name: 'Weekend',
      section_ids: ['2', '3'],
      tag: 'long',
      created_at: '2026-11-01T06:00:00Z',
    });
  });
});

describe('parseEditionInput', () => {
  it('takes a name and rules, trimmed, with duplicate sections once', () => {
    expect(
      parseEditionInput(
        {
          name: ' Weekend ',
          section_ids: ['2', '2', '5'],
          query: ' rust ',
          tag: 'long',
        },
        true,
      ),
    ).toEqual({
      ok: true,
      changes: {
        name: 'Weekend',
        section_ids: [2, 5],
        query: 'rust',
        tag: 'long',
      },
    });
  });

  it('clears a rule sent as null or blank', () => {
    expect(parseEditionInput({ query: null, tag: '  ' }, false)).toEqual({
      ok: true,
      changes: { query: null, tag: null },
    });
  });

  it.each([
    [{}, 'name: required.'],
    [{ name: ' ' }, 'name: must be a non-blank string.'],
    [{ name: 'x'.repeat(201) }, 'name: too long.'],
    [
      { name: 'a', section_ids: ['self'] },
      'section_ids: must be a list of at most 50 section ids.',
    ],
    [
      { name: 'a', section_ids: '2' },
      'section_ids: must be a list of at most 50 section ids.',
    ],
    [{ name: 'a', query: 3 }, 'query: must be a string or null.'],
    [{ name: 'a', tag: 'x'.repeat(51) }, 'tag: too long.'],
    [{ name: 'a', owner: 1 }, 'owner: not a member of an edition.'],
  ])('refuses %j', (body, error) => {
    expect(parseEditionInput(body, true)).toEqual({
      ok: false,
      errors: [error],
    });
  });

  it('needs no name to change an edition', () => {
    expect(parseEditionInput({ tag: 'x' }, false)).toEqual({
      ok: true,
      changes: { tag: 'x' },
    });
  });
});
