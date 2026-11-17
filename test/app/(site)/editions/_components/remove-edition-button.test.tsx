import { describe, expect, it } from '@jest/globals';

import { RemoveEditionButton } from '@/app/(site)/editions/_components/remove-edition-button';
import { html } from '../../../../components/render';

const REMOVES_AN_EDITION_WITH_PATTERN =
  /^<div><button type="button" class="[^"]*">Remove<\/button><\/div>$/u;

describe('RemoveEditionButton', () => {
  it('removes an edition with a plain button, not a form', () => {
    expect(html(<RemoveEditionButton id={3} />)).toMatch(
      REMOVES_AN_EDITION_WITH_PATTERN,
    );
  });
});
