import { describe, expect, it } from '@jest/globals';

import { MarkFeedReadButton } from '@/app/(site)/_components/mark-feed-read-button';
import { html } from '../../../components/render';

describe('MarkFeedReadButton', () => {
  it('is a button that acts on the page', () => {
    expect(html(<MarkFeedReadButton feedId={4} />)).toMatch(
      /<button type="button"[^>]*>Mark read<\/button>/,
    );
  });
});
