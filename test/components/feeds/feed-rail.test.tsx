import { describe, expect, it } from '@jest/globals';

import { FeedRail, type RailFeed } from '@/components/feeds/feed-rail';
import { html } from '../render';

const feed = (over: Partial<RailFeed>): RailFeed => ({
  id: 1,
  url: 'https://a.test/feed',
  title: 'A',
  icon: null,
  muted: false,
  ...over,
});

describe('FeedRail', () => {
  it('links every feed to its own page and marks the current one', async () => {
    const out = html(
      await FeedRail({
        feeds: [
          feed({}),
          feed({ id: 2, title: null, url: 'https://b.test/f' }),
        ],
        current: 2,
      }),
    );
    expect(out).toContain('href="/feeds/1"');
    expect(out).toContain('aria-current="page" href="/feeds/2"');
    expect(out).toContain('b.test');
    expect(out).toContain('href="/feeds"');
  });

  it('shows a feed icon through the image proxy', async () => {
    const out = html(
      await FeedRail({ feeds: [feed({ icon: 'https://example.com/i.png' })] }),
    );
    expect(out).toMatch(
      /<img src="\/img\?url=https%3A%2F%2Fexample\.com%2Fi\.png/,
    );
  });
});
