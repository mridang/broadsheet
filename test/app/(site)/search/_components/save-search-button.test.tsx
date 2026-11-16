import { describe, expect, it } from '@jest/globals';

import { SaveSearchButton } from '@/app/(site)/search/_components/save-search-button';
import { html } from '../../../../components/render';

const SAVES_THE_SEARCH_WITH_PATTERN =
  /^<div><button type="button" class="[^"]*">Save this search<\/button><\/div>$/;

describe('SaveSearchButton', () => {
  it('saves the search with a plain button, not a form', () => {
    expect(html(<SaveSearchButton query="rust" />)).toMatch(
      SAVES_THE_SEARCH_WITH_PATTERN,
    );
  });
});
