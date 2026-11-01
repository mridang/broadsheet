import { describe, expect, it } from '@jest/globals';

import {
  articleText,
  domainClean,
  feedDetails,
  feedHeader,
  isBoilerplate,
  pageDescription,
  parseFeed,
  siteName,
} from '@/lib/scraping';

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

describe('articleText', () => {
  const page = `<html><head><script>var x = "<p>not this one at all</p>";</script></head>
    <body><nav><p>Home About Contact Subscribe today</p></nav>
    <article><h2>The lede</h2>
      <p>The first paragraph has <a href="#">a link</a> in it.</p>
      <!-- <p>a commented out paragraph here</p> -->
      <p>Short one.</p>
      <p>It&#8217;s the second paragraph &amp; it&#x2019;s fine.</p>
    </article>
    <footer><p>Copyright the publisher all rights reserved</p></footer></body></html>`;

  it('keeps the article blocks as plain text, a blank line apart', () => {
    expect(articleText(page)).toBe(
      'The lede\n\nThe first paragraph has a link in it.\n\nIt\u2019s the second paragraph & it\u2019s fine.',
    );
  });

  it.each([
    '<h2><a href="#overview">#</a>Overview</h2>',
    '<h2>Overview <a href="#overview">¶</a></h2>',
    '<h2><a class="anchor" href="#o">§</a> Overview</h2>',
  ])('drops the permalink glyph from a heading: %s', (heading) => {
    expect(articleText(`<article>${heading}</article>`)).toBe('Overview');
  });

  it('falls back to the main element, then the body', () => {
    expect(
      articleText('<main><p>Words from the main element here.</p></main>'),
    ).toBe('Words from the main element here.');
    expect(
      articleText('<body><p>Words straight from the body here.</p></body>'),
    ).toBe('Words straight from the body here.');
  });

  it('is empty for a page with no paragraphs', () => {
    expect(articleText('<html><body><div>Nothing</div></body></html>')).toBe(
      '',
    );
  });

  it('caps very long text', () => {
    const long = `<p>${'word '.repeat(20_000)}</p>`;
    expect(articleText(long)).toHaveLength(60_000);
  });
});

describe('feedDetails', () => {
  const rss = `<?xml version="1.0"?><rss version="2.0" xmlns:sy="http://purl.org/rss/1.0/modules/syndication/">
    <channel><title>Shopify Engineering</title><link>https://shopify.engineering/</link>
    <description>How we build &amp; scale.</description><language>en-us</language>
    <lastBuildDate>Fri, 30 Oct 2026 10:00:00 GMT</lastBuildDate>
    <sy:updatePeriod>hourly</sy:updatePeriod><sy:updateFrequency>2</sy:updateFrequency>
    <image><url>/logo.png</url><title>Logo</title><link>https://elsewhere.test/</link></image>
    <item><title>A post</title><link>https://shopify.engineering/a</link><description>Not the feed.</description></item>
    </channel></rss>`;

  it('reads an RSS header and ignores the items and the image block', () => {
    expect(feedDetails(rss, 'https://shopify.engineering/blog.rss')).toEqual({
      format: 'rss',
      title: 'Shopify Engineering',
      site_url: 'https://shopify.engineering/',
      description: 'How we build & scale.',
      language: 'en-us',
      updated_at: '2026-10-30T10:00:00.000Z',
      update_minutes: 30,
      icon: 'https://shopify.engineering/logo.png',
    });
  });

  it('reads an Atom header, its alternate link, language and icon', () => {
    const atom = `<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="de">
      <title>Blog</title><subtitle>Notes</subtitle>
      <link rel="self" href="https://b.test/feed.atom"/><link rel="alternate" href="https://b.test/"/>
      <updated>2026-10-01T00:00:00Z</updated><icon>https://b.test/i.png</icon>
      <entry><title>Post</title><link href="https://b.test/p"/></entry></feed>`;
    expect(feedDetails(atom, 'https://b.test/feed.atom')).toEqual({
      format: 'atom',
      title: 'Blog',
      site_url: 'https://b.test/',
      description: 'Notes',
      language: 'de',
      updated_at: '2026-10-01T00:00:00.000Z',
      icon: 'https://b.test/i.png',
    });
  });

  it('takes ttl as the update interval and leaves a missing image blank', () => {
    const plain = `<rss><channel><title>T</title><link>https://t.test/</link><ttl>60</ttl></channel></rss>`;
    expect(feedDetails(plain, 'https://t.test/rss')).toMatchObject({
      update_minutes: 60,
      icon: '',
    });
  });

  it('names an RDF feed and leaves unknown documents without a format', () => {
    expect(
      feedDetails('<rdf:RDF><channel/></rdf:RDF>', 'https://r.test/'),
    ).toMatchObject({ format: 'rdf' });
    expect(feedDetails('<html></html>', 'https://h.test/')).not.toHaveProperty(
      'format',
    );
  });
});

describe('feedHeader', () => {
  it('keeps every RSS channel element with its attributes and children', () => {
    const xml = `<?xml version="1.0"?><!-- c --><rss version="2.0"><channel>
      <title><![CDATA[A & B]]></title><generator>Hugo</generator>
      <category domain="x">Tech</category><category>Ops</category>
      <cloud domain="rpc.test" port="80" path="/RPC2" registerProcedure="p" protocol="xml-rpc"/>
      <image><url>https://i.test/l.png</url><width>88</width></image>
      <skipHours><hour>1</hour><hour>2</hour></skipHours>
      <item><title>Not header</title></item></channel></rss>`;
    expect(feedHeader(xml)).toEqual([
      { name: 'title', attributes: {}, text: 'A & B', children: [] },
      { name: 'generator', attributes: {}, text: 'Hugo', children: [] },
      {
        name: 'category',
        attributes: { domain: 'x' },
        text: 'Tech',
        children: [],
      },
      { name: 'category', attributes: {}, text: 'Ops', children: [] },
      {
        name: 'cloud',
        attributes: {
          domain: 'rpc.test',
          port: '80',
          path: '/RPC2',
          registerProcedure: 'p',
          protocol: 'xml-rpc',
        },
        text: '',
        children: [],
      },
      {
        name: 'image',
        attributes: {},
        text: '',
        children: [
          {
            name: 'url',
            attributes: {},
            text: 'https://i.test/l.png',
            children: [],
          },
          { name: 'width', attributes: {}, text: '88', children: [] },
        ],
      },
      {
        name: 'skipHours',
        attributes: {},
        text: '',
        children: [
          { name: 'hour', attributes: {}, text: '1', children: [] },
          { name: 'hour', attributes: {}, text: '2', children: [] },
        ],
      },
    ]);
  });

  it('keeps every Atom feed element except the entries', () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><id>urn:x</id>
      <author><name>Ann</name><email>a@b.test</email></author>
      <link rel="self" href="https://b.test/f" type="application/atom+xml"/>
      <rights>&#169; Ann</rights><entry><id>e</id></entry></feed>`;
    expect(feedHeader(xml).map((e) => e.name)).toEqual([
      'id',
      'author',
      'link',
      'rights',
    ]);
    expect(feedHeader(xml)[1]?.children.map((c) => c.text)).toEqual([
      'Ann',
      'a@b.test',
    ]);
    expect(feedHeader(xml)[3]?.text).toBe('\u00a9 Ann');
  });

  it('is empty for something that is not a feed', () => {
    expect(feedHeader('<html><body>hi</body></html>')).toEqual([]);
  });
});
