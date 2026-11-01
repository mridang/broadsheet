import { describe, expect, it } from '@jest/globals';

import { parseSearchInput, searchResource } from '@/domain/api/search-resource';

describe('searchResource', () => {
  it('shows the search with the archive address that runs it', () => {
    expect(
      searchResource({
        id: 4,
        user_id: 1,
        query: 'rust lang',
        feed_id: 9,
        created_at: '2026-11-01 06:00:00',
      }),
    ).toEqual({
      id: '4',
      query: 'rust lang',
      feed_id: '9',
      articles: '/api/articles?q=rust+lang&feed_id=9',
      created_at: '2026-11-01T06:00:00Z',
    });
  });

  it('leaves out a feed and a time it does not have', () => {
    expect(
      searchResource({
        id: 4,
        user_id: 1,
        query: 'rust',
        feed_id: null,
        created_at: null,
      }),
    ).toEqual({ id: '4', query: 'rust', articles: '/api/articles?q=rust' });
  });
});

describe('parseSearchInput', () => {
  it('tidies the words and takes a feed id or none', () => {
    expect(parseSearchInput({ query: '  rust   lang ', feed_id: '3' })).toEqual(
      {
        ok: true,
        input: { query: 'rust lang', feed_id: 3 },
      },
    );
    expect(parseSearchInput({ query: 'rust', feed_id: null })).toEqual({
      ok: true,
      input: { query: 'rust', feed_id: null },
    });
  });

  it.each([
    [{}, 'query: required.'],
    [{ query: '  ' }, 'query: must be non-blank text.'],
    [{ query: 'x'.repeat(201) }, 'query: too long.'],
    [{ query: 'rust', feed_id: 3 }, 'feed_id: not a feed id.'],
    [
      { query: 'rust', colour: 'red' },
      'colour: not a member of a saved search.',
    ],
  ])('refuses %j', (body, error) => {
    expect(parseSearchInput(body)).toEqual({ ok: false, errors: [error] });
  });
});
