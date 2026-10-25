import { describe, expect, it } from '@jest/globals';

import { RefreshFeedsButton } from '@/app/(site)/feeds/_components/refresh-feeds-button';
import { html } from '../../../../components/render';

describe('RefreshFeedsButton', () => {
  it('refreshes with a plain button, not a form', () => {
    expect(html(<RefreshFeedsButton />)).toBe(
      '<button type="button" class="btn ghost small">Refresh now</button>',
    );
  });
});
