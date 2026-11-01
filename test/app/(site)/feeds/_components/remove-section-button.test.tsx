import { describe, expect, it } from '@jest/globals';

import { RemoveSectionButton } from '@/app/(site)/feeds/_components/remove-section-button';
import { html } from '../../../../components/render';

describe('RemoveSectionButton', () => {
  it('removes a section with a plain button, not a form', () => {
    expect(html(<RemoveSectionButton id={3} />)).toMatch(
      /^<div><button type="button" class="[^"]*">Remove<\/button><\/div>$/,
    );
  });
});
