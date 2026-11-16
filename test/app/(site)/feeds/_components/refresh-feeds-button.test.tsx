import { describe, expect, it } from '@jest/globals';

import { RefreshFeedsButton } from '@/app/(site)/feeds/_components/refresh-feeds-button';
import { html } from '../../../../components/render';

const REFRESHES_WITH_A_PLAIN_PATTERN =
  /^<button type="button" class="[^"]*">Refresh now<\/button>$/;

describe('RefreshFeedsButton', () => {
  it('refreshes with a plain button, not a form', () => {
    expect(html(<RefreshFeedsButton />)).toMatch(
      REFRESHES_WITH_A_PLAIN_PATTERN,
    );
  });
});
