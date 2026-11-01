import { describe, expect, it } from '@jest/globals';

import { TrendingFeeds } from '@/app/(site)/feeds/_components/trending-feeds';
import { html } from '../../../../components/render';

describe('TrendingFeeds', () => {
  it('prints nothing when nothing is trending', () => {
    expect(html(<TrendingFeeds feeds={[]} />)).toBe('');
  });

  it('lists each feed with how many read it and a follow button', () => {
    const out = html(
      <TrendingFeeds
        feeds={[{ url: 'https://a.test/f', title: 'A', readers: 3 }]}
      />,
    );
    expect(out).toContain('Trending feeds');
    expect(out).toContain('>A</strong>');
    expect(out).toContain('Read by 3 readers this week');
    expect(out).toContain('Follow</button>');
  });
});
