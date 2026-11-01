import { describe, expect, it } from '@jest/globals';

import { SearchForm } from '@/app/(site)/discover/_components/search-form';
import { html } from '../../../../components/render';

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
    expect(out).toMatch(/<form[^>]*action="\/discover"[^>]*method="get"/);
    expect(out).toContain('<input type="hidden" name="tab" value="podcasts"/>');
  });

  it('keeps the search and labels its field', () => {
    expect(out).toContain('value="science"');
    expect(out).toMatch(/<label for="discover-q"[^>]*>Find podcasts<\/label>/);
  });
});
