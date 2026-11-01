import { describe, expect, it } from '@jest/globals';

import { parseSourceSearch } from '@/domain/api/sources';

describe('parseSourceSearch', () => {
  it('accepts a search with a page size', () => {
    expect(
      parseSourceSearch(new URLSearchParams('q=%20rust%20&limit=5')),
    ).toEqual({
      ok: true,
      search: { q: 'rust', limit: 5 },
    });
  });

  it.each([
    ['q=a', 'q: from 2 to 200 characters.'],
    ['q=ab&order=reads', 'order: not a parameter of a search.'],
    ['q=ab&limit=0', 'limit: not a valid page size.'],
  ])('refuses %s', (query, error) => {
    const out = parseSourceSearch(new URLSearchParams(query));
    expect(out.ok ? [] : out.errors).toContain(error);
  });
});
