import { describe, expect, it } from '@jest/globals';

import { RetryFeedButton } from '@/app/(site)/feeds/_components/retry-feed-button';
import { html } from '../../../../components/render';

const RETRIES_WITH_A_PLAIN_PATTERN =
  /^<button type="button" class="[^"]*">Retry now<\/button>$/u;

describe('RetryFeedButton', () => {
  it('retries with a plain button, not a form', () => {
    expect(html(<RetryFeedButton id={3} />)).toMatch(
      RETRIES_WITH_A_PLAIN_PATTERN,
    );
  });
});
