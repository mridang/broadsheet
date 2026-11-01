import { describe, expect, it } from '@jest/globals';

import {
  FeedFormatBadge,
  FeedRowFacts,
} from '@/components/feeds/feed-row-facts';
import { html } from '../render';

const NOW = new Date('2026-10-23T09:00:00.000Z');

const facts = (
  over: Partial<Parameters<typeof FeedRowFacts>[0]['feed']> = {},
) =>
  html(
    <FeedRowFacts
      now={NOW}
      feed={{
        format: 'atom',
        update_minutes: 60,
        feed_updated_at: '2026-10-22T09:00:00.000Z',
        last_fetched_at: '2026-10-23 06:00:00',
        ...over,
      }}
    />,
  );

describe('FeedFormatBadge', () => {
  it.each([
    ['rss', 'RSS'],
    ['atom', 'Atom'],
    ['rdf', 'RSS 1.0 (RDF)'],
  ])('names %s as %s beside an icon', (format, name) => {
    const out = html(<FeedFormatBadge format={format} />);
    expect(out).toContain('<svg');
    expect(out).toContain(`</svg>${name}</span>`);
  });

  it('draws a format it does not know with the feed icon and its name', () => {
    expect(html(<FeedFormatBadge format="other" />)).toContain('other');
  });
});

describe('FeedRowFacts', () => {
  it('shows the format and how often the feed changes', () => {
    const out = facts();
    expect(out).toContain('Atom');
    expect(out).toContain('Changes hourly');
  });

  it('says when the feed last changed, exactly in the time element', () => {
    expect(facts()).toContain(
      'Updated <time dateTime="2026-10-22T09:00:00.000Z" title="Thu, 22 Oct 2026 09:00:00 GMT">yesterday</time>',
    );
  });

  it('reads the stored fetch time as UTC', () => {
    expect(facts()).toContain(
      'Fetched <time dateTime="2026-10-23T06:00:00.000Z" title="Fri, 23 Oct 2026 06:00:00 GMT">3 hours ago</time>',
    );
  });

  it('says a feed was never fetched', () => {
    expect(facts({ last_fetched_at: null })).toContain('Not fetched yet');
  });

  it('leaves out what the feed does not say', () => {
    const out = facts({
      format: null,
      update_minutes: null,
      feed_updated_at: null,
    });
    expect(out).not.toContain('<svg');
    expect(out).not.toContain('Changes');
    expect(out).not.toContain('Updated');
  });

  it('shows a time it cannot read as stored', () => {
    expect(facts({ feed_updated_at: 'soon' })).toContain('Updated soon');
  });
});
