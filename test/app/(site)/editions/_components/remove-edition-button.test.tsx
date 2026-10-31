import { describe, expect, it } from '@jest/globals';

import { RemoveEditionButton } from '@/app/(site)/editions/_components/remove-edition-button';
import { html } from '../../../../components/render';

describe('RemoveEditionButton', () => {
  it('removes an edition with a plain button, not a form', () => {
    expect(html(<RemoveEditionButton id={3} />)).toBe(
      '<div><button type="button" class="btn danger">Remove</button></div>',
    );
  });
});
