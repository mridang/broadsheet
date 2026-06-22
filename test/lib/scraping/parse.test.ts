import { describe, expect, it } from '@jest/globals';

import {
  domainClean,
  isBoilerplate,
  pageDescription,
  parseFeed,
  siteName,
} from '../../../src/lib/scraping/parse';

describe('domainClean', () => {
  it('applies curated overrides', () => {
    expect(domainClean('github.com')).toBe('GitHub');
    expect(domainClean('news.ycombinator.com')).toBe('Hacker News');
  });

  it('strips noise subdomains', () => {
    expect(domainClean('news.mit.edu')).toBe('Mit');
  });

  it('handles multi-part TLDs', () => {
    expect(domainClean('independent.co.uk')).toBe('Independent');
  });

  it('uses the subdomain label for blog platforms', () => {
    expect(domainClean('simonw.substack.com')).toBe('Simonw');
  });
});

describe('isBoilerplate', () => {
  it('detects hnrss metadata descriptions', () => {
    expect(
      isBoilerplate(
        'Article URL: https://x Comments URL: https://y Points: 10',
      ),
    ).toBe(true);
  });

  it('passes real article copy through', () => {
    expect(isBoilerplate('A thoughtful essay about compilers.')).toBe(false);
  });
});

describe('pageDescription', () => {
  it('prefers og:description', () => {
    const html = '<meta property="og:description" content="The real summary">';
    expect(pageDescription(html)).toBe('The real summary');
  });
});

describe('siteName', () => {
  it('reads og:site_name', () => {
    expect(siteName('<meta property="og:site_name" content="MIT News">')).toBe(
      'MIT News',
    );
  });
});

describe('parseFeed', () => {
  const rss = `<rss><channel><title>My Feed</title>
    <item><title>First post</title><link>https://blog.example.com/first</link>
      <description>An interesting summary.</description>
      <pubDate>Mon, 22 Jun 2026 06:00:00 GMT</pubDate></item>
  </channel></rss>`;

  it('extracts the feed title and items', () => {
    const { title, items } = parseFeed(rss, 'https://blog.example.com/feed');
    expect(title).toBe('My Feed');
    expect(items).toHaveLength(1);
    expect(items[0]?.url).toBe('https://blog.example.com/first');
    expect(items[0]?.summary).toBe('An interesting summary.');
    expect(items[0]?.source).toBe('Example');
  });

  it('blanks hnrss boilerplate summaries', () => {
    const hn = `<rss><channel><title>HN</title>
      <item><title>Story</title><link>https://x.com/y</link>
      <description>Article URL: https://x Points: 5 # Comments: 2</description></item>
    </channel></rss>`;
    const { items } = parseFeed(hn, 'https://hnrss.org/frontpage');
    expect(items[0]?.summary).toBe('');
  });
});
