import { describe, expect, it } from '@jest/globals';

import { SaveSearchButton } from '@/app/(site)/search/_components/save-search-button';
import { html } from '../../../../components/render';

describe('SaveSearchButton', () => {
  it('saves the search with a plain button, not a form', () => {
    expect(html(<SaveSearchButton query="rust" />)).toMatch(
      /^<div><button type="button" class="[^"]*">Save this search<\/button><\/div>$/,
    );
  });
});
