import { describe, expect, it } from '@jest/globals';

import { RetryFeedButton } from '@/app/(site)/feeds/_components/retry-feed-button';
import { html } from '../../../../components/render';

describe('RetryFeedButton', () => {
  it('retries with a plain button, not a form', () => {
    expect(html(<RetryFeedButton id={3} />)).toMatch(
      /^<button type="button" class="[^"]*">Retry now<\/button>$/,
    );
  });
});
