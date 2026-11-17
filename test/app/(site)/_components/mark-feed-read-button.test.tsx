import { describe, expect, it } from '@jest/globals';

import { MarkFeedReadButton } from '@/app/(site)/_components/mark-feed-read-button';
import { html } from '../../../components/render';

const IS_A_BUTTON_THAT_PATTERN =
  /<button type="button"[^>]*>Mark read<\/button>/u;

describe('MarkFeedReadButton', () => {
  it('is a button that acts on the page', () => {
    expect(html(<MarkFeedReadButton feedId={4} />)).toMatch(
      IS_A_BUTTON_THAT_PATTERN,
    );
  });
});
