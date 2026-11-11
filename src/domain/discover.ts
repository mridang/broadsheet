/**
 * @packageDocumentation
 *
 * Finding feeds, after NewsBlur's discover: turning a newsletter, blog or
 * YouTube channel address into its feed, building a Google News feed for a
 * search or a topic, and reading the answers of iTunes Search for podcasts.
 * Nothing here touches
 * the database or the network; the controllers in `api/discover` do.
 */

/** The kind of site a feed address belongs to. */
export type Platform =
  | 'substack'
  | 'medium'
  | 'ghost'
  | 'buttondown'
  | 'beehiiv'
  | 'convertkit'
  | 'revue'
  | 'youtube'
  | 'google-news'
  | 'direct'
  | 'generic';

/** A feed found for an address. */
export interface Conversion {
  readonly feed_url: string;
  readonly platform: Platform;
  readonly title?: string;
}

/** A name from an address segment: dashes to spaces, each word capitalised. */
function titled(slug: string): string {
  return slug
    .replaceAll(/[-_]+/g, ' ')
    .replaceAll(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/** Whether an address already looks like a feed. */
function looksLikeFeed(url: string): boolean {
  return /\/(feed|rss|atom)(\/|\.xml)?$|\.(xml|rss|atom)$/i.test(url);
}

/**
 * The feed of a newsletter, blog or YouTube channel address, after
 * NewsBlur's newsletter conversion: Substack, Medium, Ghost, Buttondown,
 * Beehiiv, ConvertKit and Revue by their own rules;
 * a YouTube channel (`/channel/UC…`) as its videos feed; an address that is
 * already a feed as it is; anything else with `/feed` added. Undefined for
 * something that is not an `http(s)` address.
 */
export function convertToFeed(input: string): Conversion | undefined {
  const text = input.trim();
  if (/^[a-z][\w+.-]*:\/\//i.test(text) && !/^https?:\/\//i.test(text)) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  const host = url.hostname.toLowerCase();
  // eslint-disable-next-line sonarjs/super-linear-regex -- a parsed URL path is short, so the scan stays cheap
  const base = `${url.origin}${url.pathname}`.replace(/\/+$/, '');
  const [first = '', second = ''] = url.pathname.split('/').filter(Boolean);
  if (host.endsWith('.substack.com')) {
    const name = host.slice(0, -'.substack.com'.length);
    return {
      feed_url: `https://${name}.substack.com/feed`,
      platform: 'substack',
      title: titled(name),
    };
  }
  if (host === 'medium.com' || host.endsWith('.medium.com')) {
    if (host !== 'medium.com') {
      return { feed_url: `${url.origin}/feed`, platform: 'medium' };
    }
    if (!first) return undefined;
    return {
      feed_url: `https://medium.com/feed/${first}`,
      platform: 'medium',
      title: titled(first.replace(/^@/, '')),
    };
  }
  if (host.endsWith('.ghost.io') || url.pathname.includes('/ghost/')) {
    return {
      feed_url: `${url.origin}/rss/`,
      platform: 'ghost',
    };
  }
  if (host === 'buttondown.email' || host === 'buttondown.com') {
    if (!first) return undefined;
    return {
      feed_url: `https://buttondown.com/${first}/rss`,
      platform: 'buttondown',
      title: titled(first),
    };
  }
  if (host.endsWith('.beehiiv.com')) {
    return { feed_url: `${url.origin}/feed`, platform: 'beehiiv' };
  }
  if (host.endsWith('.ck.page') || host.endsWith('convertkit.com')) {
    return { feed_url: `${base}/rss`, platform: 'convertkit' };
  }
  if (host.endsWith('getrevue.co') || host.endsWith('revue.co')) {
    const name = first === 'profile' ? second : first;
    if (!name) return undefined;
    return {
      feed_url: `https://www.getrevue.co/profile/${name}/feed`,
      platform: 'revue',
      title: titled(name),
    };
  }
  if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
    if (first === 'channel' && /^UC[\w-]{22}$/.test(second)) {
      return {
        feed_url: `https://www.youtube.com/feeds/videos.xml?channel_id=${second}`,
        platform: 'youtube',
      };
    }
    const list = url.searchParams.get('list');
    if (first === 'playlist' && list) {
      return {
        feed_url: `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(list)}`,
        platform: 'youtube',
      };
    }
    return undefined;
  }
  if (looksLikeFeed(base)) return { feed_url: base, platform: 'direct' };
  return { feed_url: `${base}/feed`, platform: 'generic' };
}

/** A Google News topic: its name and the id its feed is built from. */
export interface NewsTopic {
  readonly id: string;
  readonly name: string;
  readonly topicKey: string;
}

/** Google News' own sections, with the keys their topic feeds use. */
export const GOOGLE_NEWS_TOPICS: readonly NewsTopic[] = [
  {
    id: 'WORLD',
    name: 'World',
    topicKey: 'CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx1YlY4U0FtVnVHZ0pWVXlnQVAB',
  },
  {
    id: 'NATION',
    name: 'Nation',
    topicKey: 'CAAqIggKIhxDQkFTRHdvSkwyMHZNRFY2TVdZeUVnSmxiaWdBUAE',
  },
  {
    id: 'BUSINESS',
    name: 'Business',
    topicKey: 'CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtVnVHZ0pWVXlnQVAB',
  },
  {
    id: 'TECHNOLOGY',
    name: 'Technology',
    topicKey: 'CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtVnVHZ0pWVXlnQVAB',
  },
  {
    id: 'ENTERTAINMENT',
    name: 'Entertainment',
    topicKey: 'CAAqJggKIiBDQkFTRWdvSUwyMHZNREpxYW5RU0FtVnVHZ0pWVXlnQVAB',
  },
  {
    id: 'SPORTS',
    name: 'Sports',
    topicKey: 'CAAqJggKIiBDQkFTRWdvSUwyMHZNRFp1ZEdvU0FtVnVHZ0pWVXlnQVAB',
  },
  {
    id: 'SCIENCE',
    name: 'Science',
    topicKey: 'CAAqJggKIiBDQkFTRWdvSUwyMHZNRFp0Y1RjU0FtVnVHZ0pWVXlnQVAB',
  },
  {
    id: 'HEALTH',
    name: 'Health',
    topicKey: 'CAAqIQgKIhtDQkFTRGdvSUwyMHZNR3QwTlRFU0FtVnVLQUFQAQ',
  },
];

/** What a Google News feed is built from: a search or a topic, in a language and region. */
export interface NewsFeedRequest {
  readonly query?: string;
  readonly topic?: string;
  readonly language?: string;
  readonly region?: string;
}

/**
 * The Google News feed for a topic (one of {@link GOOGLE_NEWS_TOPICS}) or a
 * search, in a language (`en`) and region (`US`). Undefined when neither a
 * known topic nor a query is given, or the language or region is not a code.
 */
export function googleNewsFeed(
  request: NewsFeedRequest,
): Conversion | undefined {
  const language = request.language ?? 'en';
  const region = (request.region ?? 'US').toUpperCase();
  if (
    !/^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(language) ||
    !/^[A-Z]{2}$/.test(region)
  ) {
    return undefined;
  }
  const where = `hl=${language}&gl=${region}&ceid=${region}:${language}`;
  const topic = GOOGLE_NEWS_TOPICS.find(
    (t) => t.id === request.topic?.toUpperCase(),
  );
  if (topic) {
    return {
      feed_url: `https://news.google.com/rss/topics/${topic.topicKey}?${where}`,
      platform: 'google-news',
      title: `Google News - ${topic.name}`,
    };
  }
  const query = request.query?.trim();
  if (!query) return undefined;
  return {
    feed_url: `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${where}`,
    platform: 'google-news',
    title: `Google News - ${query}`,
  };
}

/** A podcast found by search, with its feed. */
export interface Podcast {
  readonly name: string;
  readonly author?: string;
  readonly artwork?: string;
  readonly feed_url: string;
  readonly genre?: string;
  readonly episodes?: number;
  readonly link?: string;
}

/** A string member, or undefined. */
function str(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/** The podcasts in an iTunes Search answer that have a feed. */
export function podcastsFrom(body: unknown): Podcast[] {
  const results = (body as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  return results.flatMap((raw: unknown) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const feed = str(r['feedUrl']);
    if (!feed) return [];
    const episodes = r['trackCount'];
    return [
      {
        name: str(r['collectionName']) ?? feed,
        ...(str(r['artistName']) ? { author: str(r['artistName']) } : {}),
        ...(str(r['artworkUrl100'])
          ? { artwork: str(r['artworkUrl100']) }
          : {}),
        feed_url: feed,
        ...(str(r['primaryGenreName'])
          ? { genre: str(r['primaryGenreName']) }
          : {}),
        ...(typeof episodes === 'number' ? { episodes } : {}),
        ...(str(r['collectionViewUrl'])
          ? { link: str(r['collectionViewUrl']) }
          : {}),
      },
    ];
  });
}
