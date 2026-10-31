import { describe, expect, it } from '@jest/globals';

import { SuggestedFeeds } from '@/app/(site)/feeds/_components/suggested-feeds';
import { html } from '../../../../components/render';

describe('SuggestedFeeds', () => {
  it('lists each suggestion with a Follow button', () => {
    const out = html(
      <SuggestedFeeds
        feeds={[{ url: 'https://a.test/f', title: 'A', followers: 2 }]}
      />,
    );
    expect(out).toContain('You might also like');
    expect(out).toContain('<strong>A</strong>');
    expect(out).toContain('>Follow</button>');
    expect(out).toContain('Followed by 2 readers');
  });

  it('names a source with no title by its host', () => {
    const out = html(
      <SuggestedFeeds
        feeds={[{ url: 'https://a.test/f', title: null, followers: 1 }]}
      />,
    );
    expect(out).toContain('<strong>a.test</strong>');
    expect(out).toContain('Followed by 1 reader like you');
  });

  it('shows nothing when there is nothing to suggest', () => {
    expect(html(<SuggestedFeeds feeds={[]} />)).toBe('');
  });
});
