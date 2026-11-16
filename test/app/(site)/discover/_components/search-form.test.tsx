import { describe, expect, it } from '@jest/globals';

import { SearchForm } from '@/app/(site)/discover/_components/search-form';
import { html } from '../../../../components/render';

const SEARCHES_WITH_A_PLAIN_PATTERN =
  /<form[^>]*action="\/discover"[^>]*method="get"/;
const KEEPS_THE_SEARCH_AND_PATTERN =
  /<label for="discover-q"[^>]*>Find podcasts<\/label>/;

describe('SearchForm', () => {
  const out = html(
    <SearchForm
      tab="podcasts"
      query="science"
      label="Find podcasts"
      placeholder="A show"
    />,
  );

  it('searches with a plain GET back to its tab', () => {
    expect(out).toMatch(SEARCHES_WITH_A_PLAIN_PATTERN);
    expect(out).toContain('<input type="hidden" name="tab" value="podcasts"/>');
  });

  it('keeps the search and labels its field', () => {
    expect(out).toContain('value="science"');
    expect(out).toMatch(KEEPS_THE_SEARCH_AND_PATTERN);
  });
});
