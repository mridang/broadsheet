import { describe, expect, it } from '@jest/globals';

import { DiscoverList } from '@/app/(site)/discover/_components/discover-list';
import { html } from '../../../../components/render';

const SHOWS_EACH_FEED_WITH_PATTERN =
  /<a[^>]*href="https:\/\/a\.test\/"[^>]*>A show<\/a>/;
const SHOWS_EACH_FEED_WITH_PATTERN_2 = /<img[^>]*src="\/img\/x"/;
const SHOWS_EACH_FEED_WITH_PATTERN_3 =
  /<button type="button"[^>]*>Follow<\/button>/;
const NAMES_A_FEED_WITH_PATTERN = /<strong[^>]*>b\.test<\/strong>/;
const SHOWS_A_FEED_ALREADY_PATTERN =
  /<button type="button"[^>]*disabled=""[^>]*>Following<\/button>/;

describe('DiscoverList', () => {
  it('shows each feed with its facts and a Follow button', () => {
    const out = html(
      <DiscoverList
        feeds={[
          {
            url: 'https://a.test/feed',
            title: 'A show',
            detail: 'By someone',
            meta: ['News', '', '3 episodes'],
            picture: '/img/x',
            link: 'https://a.test/',
          },
        ]}
      />,
    );
    expect(out).toMatch(SHOWS_EACH_FEED_WITH_PATTERN);
    expect(out).toContain('https://a.test/feed');
    expect(out).toContain('By someone');
    expect(out).toContain('News · 3 episodes');
    expect(out).toMatch(SHOWS_EACH_FEED_WITH_PATTERN_2);
    expect(out).toMatch(SHOWS_EACH_FEED_WITH_PATTERN_3);
  });

  it('names a feed with no title by its host, with no picture or link', () => {
    const out = html(<DiscoverList feeds={[{ url: 'https://b.test/rss' }]} />);
    expect(out).toMatch(NAMES_A_FEED_WITH_PATTERN);
    expect(out).not.toContain('<img');
  });

  it('shows a feed already followed as followed, and not followable', () => {
    const out = html(
      <DiscoverList feeds={[{ url: 'https://c.test/rss', followed: true }]} />,
    );
    expect(out).toMatch(SHOWS_A_FEED_ALREADY_PATTERN);
  });
});
