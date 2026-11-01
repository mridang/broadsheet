/**
 * @packageDocumentation
 *
 * The curated topics a new reader picks from, each with a few starter feeds.
 */

/** A starter feed within a topic. */
export interface TopicFeed {
  readonly title: string;
  readonly url: string;
}

/** A subject with the feeds that cover it. */
export interface Topic {
  readonly id: string;
  readonly name: string;
  /** One line on what the topic covers. */
  readonly description: string;
  readonly feeds: readonly TopicFeed[];
}

/** Every topic on offer, in the order they are shown. */
export const TOPICS: readonly Topic[] = [
  {
    id: 'world',
    name: 'World news',
    description: 'Headlines and reporting from around the globe.',
    feeds: [
      { title: 'BBC News', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
      { title: 'NPR News', url: 'https://feeds.npr.org/1001/rss.xml' },
      {
        title: 'Al Jazeera',
        url: 'https://www.aljazeera.com/xml/rss/all.xml',
      },
    ],
  },
  {
    id: 'technology',
    name: 'Technology',
    description: 'Software, hardware and the industry around them.',
    feeds: [
      { title: 'Hacker News', url: 'https://hnrss.org/frontpage' },
      {
        title: 'Ars Technica',
        url: 'https://feeds.arstechnica.com/arstechnica/index',
      },
      { title: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
    ],
  },
  {
    id: 'science',
    name: 'Science',
    description: 'Discoveries, research and space.',
    feeds: [
      {
        title: 'Quanta Magazine',
        url: 'https://api.quantamagazine.org/feed/',
      },
      { title: 'Nature News', url: 'https://www.nature.com/nature.rss' },
      {
        title: 'NASA Breaking News',
        url: 'https://www.nasa.gov/rss/dyn/breaking_news.rss',
      },
    ],
  },
  {
    id: 'business',
    name: 'Business',
    description: 'Markets, companies and the economy.',
    feeds: [
      {
        title: 'BBC Business',
        url: 'https://feeds.bbci.co.uk/news/business/rss.xml',
      },
      { title: 'Marketplace', url: 'https://www.marketplace.org/feed/' },
    ],
  },
  {
    id: 'design',
    name: 'Design',
    description: 'Craft, typography and the web.',
    feeds: [
      { title: 'A List Apart', url: 'https://alistapart.com/main/feed/' },
      {
        title: 'Smashing Magazine',
        url: 'https://www.smashingmagazine.com/feed/',
      },
    ],
  },
  {
    id: 'culture',
    name: 'Culture',
    description: 'Film, music, books and the arts.',
    feeds: [
      {
        title: 'The Guardian: Culture',
        url: 'https://www.theguardian.com/culture/rss',
      },
      { title: 'Pitchfork', url: 'https://pitchfork.com/feed/feed-news/rss' },
    ],
  },
];

/** The topic with this id, or undefined. */
export function findTopic(id: string): Topic | undefined {
  return TOPICS.find((topic) => topic.id === id);
}
