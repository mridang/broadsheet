import { describe, expect, it } from '@jest/globals';

import { suggestionResource } from '@/domain/api/suggestions';

describe('suggestionResource', () => {
  it('shows the address, title and follower count', () => {
    expect(
      suggestionResource({ id: 1, url: 'https://a', title: 'A', followers: 2 }),
    ).toEqual({ url: 'https://a', title: 'A', followers: 2 });
  });

  it('leaves out a missing title, and the source id', () => {
    expect(
      suggestionResource({
        id: 1,
        url: 'https://a',
        title: null,
        followers: 1,
      }),
    ).toEqual({ url: 'https://a', followers: 1 });
  });
});
