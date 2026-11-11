import { describe, expect, it } from '@jest/globals';

import {
  convertToFeed,
  GOOGLE_NEWS_TOPICS,
  googleNewsFeed,
  podcastsFrom,
} from '@/domain/discover';

describe('convertToFeed', () => {
  it.each([
    [
      'https://jane.substack.com/',
      'https://jane.substack.com/feed',
      'substack',
    ],
    ['jane.substack.com', 'https://jane.substack.com/feed', 'substack'],
    ['https://medium.com/@jane', 'https://medium.com/feed/@jane', 'medium'],
    [
      'https://medium.com/some-pub/a-post',
      'https://medium.com/feed/some-pub',
      'medium',
    ],
    ['https://pub.medium.com/x', 'https://pub.medium.com/feed', 'medium'],
    ['https://blog.ghost.io/post/', 'https://blog.ghost.io/rss/', 'ghost'],
    [
      'https://buttondown.email/jane',
      'https://buttondown.com/jane/rss',
      'buttondown',
    ],
    [
      'https://news.beehiiv.com/p/x',
      'https://news.beehiiv.com/feed',
      'beehiiv',
    ],
    ['https://jane.ck.page', 'https://jane.ck.page/rss', 'convertkit'],
    [
      'https://www.getrevue.co/profile/jane',
      'https://www.getrevue.co/profile/jane/feed',
      'revue',
    ],
    [
      'https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv',
      'https://www.youtube.com/feeds/videos.xml?channel_id=UCabcdefghijklmnopqrstuv',
      'youtube',
    ],
    [
      'https://www.youtube.com/playlist?list=PL123',
      'https://www.youtube.com/feeds/videos.xml?playlist_id=PL123',
      'youtube',
    ],
    ['https://example.com/feed.xml', 'https://example.com/feed.xml', 'direct'],
    ['https://example.com/blog/rss/', 'https://example.com/blog/rss', 'direct'],
    ['https://example.com/blog', 'https://example.com/blog/feed', 'generic'],
  ])('finds the feed of %s', (url, feed, platform) => {
    expect(convertToFeed(url)).toMatchObject({ feed_url: feed, platform });
  });

  it('names a newsletter from its address', () => {
    expect(convertToFeed('https://the-weekly.substack.com')?.title).toBe(
      'The Weekly',
    );
  });

  it.each([
    'ftp://example.com',
    'https://medium.com',
    'https://buttondown.email',
    'https://www.youtube.com/@handle',
    'not a url at all',
  ])('finds nothing for %s', (url) => {
    expect(convertToFeed(url)).toBeUndefined();
  });
});

describe('googleNewsFeed', () => {
  it('builds a topic feed in a language and region', () => {
    expect(
      googleNewsFeed({ topic: 'science', language: 'de', region: 'de' }),
    ).toEqual({
      feed_url: `https://news.google.com/rss/topics/${GOOGLE_NEWS_TOPICS.find((t) => t.id === 'SCIENCE')!.topicKey}?hl=de&gl=DE&ceid=DE:de`,
      platform: 'google-news',
      title: 'Google News - Science',
    });
  });

  it('builds a search feed, in English and the US by default', () => {
    expect(googleNewsFeed({ query: 'rust & go' })?.feed_url).toBe(
      'https://news.google.com/rss/search?q=rust%20%26%20go&hl=en&gl=US&ceid=US:en',
    );
  });

  it.each([
    {},
    { topic: 'NOPE' },
    { query: 'x', language: 'english' },
    { query: 'x', region: 'USA' },
  ])('builds nothing from %j', (request) => {
    expect(googleNewsFeed(request)).toBeUndefined();
  });
});

describe('podcastsFrom', () => {
  it('keeps the podcasts with a feed', () => {
    expect(
      podcastsFrom({
        results: [
          {
            collectionName: 'Pod',
            artistName: 'A',
            feedUrl: 'https://p/feed',
            trackCount: 3,
            primaryGenreName: 'News',
          },
          { collectionName: 'No feed' },
        ],
      }),
    ).toEqual([
      {
        name: 'Pod',
        author: 'A',
        feed_url: 'https://p/feed',
        genre: 'News',
        episodes: 3,
      },
    ]);
  });

  it('finds none in an answer of another shape', () => {
    expect(podcastsFrom(null)).toEqual([]);
    expect(podcastsFrom({ results: 'x' })).toEqual([]);
  });
});
