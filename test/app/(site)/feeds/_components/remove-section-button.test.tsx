import { describe, expect, it } from '@jest/globals';

import { RemoveSectionButton } from '@/app/(site)/feeds/_components/remove-section-button';
import { html } from '../../../../components/render';

describe('RemoveSectionButton', () => {
  it('removes a section, or it and its feeds, with plain buttons, not a form', () => {
    expect(html(<RemoveSectionButton id={3} />)).toMatch(
      /^<div class="[^"]*"><button type="button" class="[^"]*">Remove<\/button><button type="button" class="[^"]*">Remove with feeds<\/button><\/div>$/,
    );
  });
});
