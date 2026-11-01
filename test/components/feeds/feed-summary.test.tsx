import { describe, expect, it } from '@jest/globals';

import { FeedSummary } from '@/components/feeds/feed-summary';
import type { Feed } from '@/domain/repository';
import { html } from '../render';

const feed = (over: Partial<Feed> = {}): Feed => ({
  id: 1,
  user_id: 1,
  source_id: 1,
  section_id: null,
  url: 'https://a.test/feed',
  title: 'Shopify Engineering',
  muted: false,
  created_at: null,
  icon: null,
  format: 'atom',
  site_url: 'https://a.test/',
  description: 'How we build.',
  language: 'en',
  feed_updated_at: '2026-10-22T12:56:38.000Z',
  update_minutes: 60,
  last_fetched_at: '2026-10-23 06:00:00',
  header: null,
  ...over,
});

describe('FeedSummary', () => {
  it('shows the name, format, description, site and facts', async () => {
    const out = html(await FeedSummary({ feed: feed(), heading: true }));
    expect(out).toContain('<h1>Shopify Engineering</h1>');
    expect(out).toContain('<span class="badge">Atom</span>');
    expect(out).toContain('How we build.');
    expect(out).toContain('href="https://a.test/"');
    expect(out).toContain('href="https://a.test/feed"');
    expect(out).toContain('Language en');
    expect(out).toContain('Changes hourly');
    expect(out).toContain('Updated 22 Oct 2026, 12:56 UTC');
    expect(out).toContain('Fetched 23 Oct 2026, 06:00 UTC');
  });

  it('shows every declared fact and the feed image on the feed page', async () => {
    const header = [
      { name: 'generator', attributes: {}, text: 'WordPress', children: [] },
      {
        name: 'image',
        attributes: {},
        text: '',
        children: [
          {
            name: 'url',
            attributes: {},
            text: 'https://example.com/i.png',
            children: [],
          },
          { name: 'title', attributes: {}, text: 'The Blog', children: [] },
        ],
      },
    ];
    const out = html(
      await FeedSummary({
        feed: feed({ header: JSON.stringify(header) }),
        heading: true,
      }),
    );
    expect(out).toContain('<dt>Generator</dt><dd>WordPress</dd>');
    expect(out).toMatch(
      /<img src="\/img\?url=https%3A%2F%2Fexample\.com%2Fi\.png[^"]*" alt="The Blog"/,
    );
  });

  it('says a feed that was never fetched has not been, named by its host', async () => {
    const out = html(
      await FeedSummary({
        feed: feed({
          title: null,
          format: null,
          last_fetched_at: null,
          feed_updated_at: null,
          update_minutes: null,
        }),
      }),
    );
    expect(out).toContain('<strong>a.test</strong>');
    expect(out).toContain('Not fetched yet');
    expect(out).not.toContain('badge');
  });
});
