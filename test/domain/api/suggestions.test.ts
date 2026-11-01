import { describe, expect, it } from '@jest/globals';

import {
  similarSourceResource,
  suggestionResource,
} from '@/domain/api/suggestions';

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

describe('similarSourceResource', () => {
  it('links each headline to its page', () => {
    expect(
      similarSourceResource({
        id: 1,
        url: 'https://a',
        title: null,
        followers: 2,
        stories: [
          { id: 4, title: 'Four' },
          { id: 5, title: null },
        ],
      }),
    ).toEqual({
      url: 'https://a',
      followers: 2,
      stories: [
        { article_id: '4', title: 'Four', href: '/article/4' },
        { article_id: '5', href: '/article/5' },
      ],
    });
  });
});
