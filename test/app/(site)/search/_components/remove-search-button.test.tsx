import { describe, expect, it } from '@jest/globals';

import { RemoveSearchButton } from '@/app/(site)/search/_components/remove-search-button';
import { html } from '../../../../components/render';

const REMOVES_A_SEARCH_WITH_PATTERN =
  /^<button type="button" class="[^"]*">Remove<\/button>$/u;

describe('RemoveSearchButton', () => {
  it('removes a search with a plain button, not a form', () => {
    const out = html(<RemoveSearchButton id={3} />);
    expect(out).toMatch(REMOVES_A_SEARCH_WITH_PATTERN);
  });
});
