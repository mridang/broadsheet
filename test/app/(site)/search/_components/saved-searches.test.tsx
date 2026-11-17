import { describe, expect, it } from '@jest/globals';

import {
  SavedSearches,
  searchHref,
} from '@/app/(site)/search/_components/saved-searches';
import { html } from '../../../../components/render';

const LINKS_EACH_SEARCH_WITH_PATTERN =
  /<a [^>]*href="\/search\?q=rust">rust<\/a>/u;

describe('searchHref', () => {
  it('runs the search over its feed when it has one', () => {
    expect(searchHref({ query: 'rust lang', feed_id: null })).toBe(
      '/search?q=rust+lang',
    );
    expect(searchHref({ query: 'go', feed_id: 4 })).toBe(
      '/search?q=go&feed_id=4',
    );
  });
});

describe('SavedSearches', () => {
  it('prints nothing without saved searches', () => {
    expect(html(<SavedSearches searches={[]} />)).toBe('');
  });

  it('links each search with a button to remove it', () => {
    const out = html(
      <SavedSearches
        searches={[
          { id: 1, user_id: 7, query: 'rust', feed_id: null, created_at: null },
        ]}
      />,
    );
    expect(out).toMatch(LINKS_EACH_SEARCH_WITH_PATTERN);
    expect(out).toContain('Remove</button>');
  });
});
