import { describe, expect, it } from '@jest/globals';

import { RemoveFeedButton } from '@/app/(site)/feeds/_components/remove-feed-button';
import { html } from '../../../../components/render';

describe('RemoveFeedButton', () => {
  it('removes a feed with a plain button, not a form', () => {
    expect(html(<RemoveFeedButton id={3} />)).toBe(
      '<div><button type="button" class="btn danger">Remove</button></div>',
    );
  });
});
