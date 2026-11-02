import { describe, expect, it } from '@jest/globals';

import {
  articleText,
  domainClean,
  feedDetails,
  feedHeader,
  itemImage,
  isBoilerplate,
  pageDescription,
  itemAuthor,
  itemTags,
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

  it('decodes numeric references in titles, plain and in CDATA', () => {
    const feed = `<rss><channel><title>F</title>
      <item><title>Progress on TypeScript 7 &#8211; December 2025</title><link>https://x/a</link></item>
      <item><title><![CDATA[It&#8217;s &#x2013; here]]></title><link>https://x/b</link></item>
    </channel></rss>`;
    const { items } = parseFeed(feed, 'https://x/feed');
    expect(items[0]?.title).toBe(
      'Progress on TypeScript 7 \u2013 December 2025',
    );
    expect(items[1]?.title).toBe('It\u2019s \u2013 here');
  });

  it('keeps the feed’s own id for each story', () => {
    const feed = `<rss><channel><title>F</title>
      <item><title>A</title><link>https://x/a</link><guid isPermaLink="false">tag:x,1</guid></item>
      <item><title>B</title><link>https://x/b</link></item>
    </channel></rss>`;
    const atom = `<feed><title>F</title><entry><title>C</title>
      <link href="https://x/c"/><id>urn:uuid:3</id></entry></feed>`;
    const { items } = parseFeed(feed, 'https://x/feed');
    expect(items[0]?.guid).toBe('tag:x,1');
    expect(items[1]).not.toHaveProperty('guid');
    expect(parseFeed(atom, 'https://x/feed').items[0]?.guid).toBe('urn:uuid:3');
  });

  it('blanks hnrss boilerplate summaries', () => {
    const hn = `<rss><channel><title>HN</title>
      <item><title>Story</title><link>https://x.com/y</link>
      <description>Article URL: https://x Points: 5 # Comments: 2</description></item>
    </channel></rss>`;
    const { items } = parseFeed(hn, 'https://hnrss.org/frontpage');
    expect(items[0]?.summary).toBe('');
  });

  it('keeps where an item is discussed', () => {
    const hn = `<rss><channel><title>HN</title>
      <item><title>Story</title><link>https://x.com/y</link>
      <comments>https://news.ycombinator.com/item?id=1</comments></item>
    </channel></rss>`;
    const { items } = parseFeed(hn, 'https://hnrss.org/frontpage');
    expect(items[0]?.comments_url).toBe(
      'https://news.ycombinator.com/item?id=1',
    );
  });

  it('leaves the discussion out when the feed names none', () => {
    const { items } = parseFeed(rss, 'https://blog.example.com/feed');
    expect(items[0]).not.toHaveProperty('comments_url');
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

describe('itemAuthor', () => {
  it.each([
    [
      '<author><name>Ada Lovelace</name><email>a@x</email></author>',
      'Ada Lovelace',
    ],
    ['<dc:creator><![CDATA[Grace Hopper]]></dc:creator>', 'Grace Hopper'],
    ['<author>ada@x.test (Ada Lovelace)</author>', 'Ada Lovelace'],
    ['<author>Alan Turing</author>', 'Alan Turing'],
    ['<title>No author</title>', ''],
  ])('reads %s as %j', (block, author) => {
    expect(itemAuthor(block)).toBe(author);
  });

  it('keeps at most 120 characters', () => {
    expect(itemAuthor(`<author>${'a'.repeat(200)}</author>`)).toHaveLength(120);
  });
});

describe('itemTags', () => {
  it('reads RSS categories and Atom terms, once each', () => {
    expect(
      itemTags(
        '<category>Rust</category><category><![CDATA[Go]]></category><category term="Rust"/><category term="Web" />',
      ),
    ).toEqual(['Rust', 'Go', 'Web']);
  });

  it('finds none in an item without categories', () => {
    expect(itemTags('<title>x</title>')).toEqual([]);
  });

  it('keeps at most 20 tags of at most 60 characters', () => {
    const many = Array.from(
      { length: 25 },
      (_, i) => `<category>t${i}${'x'.repeat(70)}</category>`,
    ).join('');
    const tags = itemTags(many);
    expect(tags).toHaveLength(20);
    expect(tags.every((t) => t.length === 60)).toBe(true);
  });
});

describe('parseFeed authors and tags', () => {
  it('gives each item its author and categories', () => {
    const { items } = parseFeed(
      `<rss><channel><title>F</title><item><title>T</title><link>https://a.test/1</link><dc:creator>Ada</dc:creator><category>Rust</category></item></channel></rss>`,
      'https://a.test/feed',
    );
    expect(items[0]).toMatchObject({ author: 'Ada', tags: ['Rust'] });
  });
});

describe('itemImage', () => {
  const base = 'https://blog.example.com/post';

  it.each([
    [
      '<enclosure url="https://x.test/e.png" type="image/png" length="0"/><media:content url="https://x.test/m.png"/>',
      'https://x.test/e.png',
    ],
    [
      '<enclosure url="https://x.test/a.mp3" type="audio/mpeg"/><media:content url="https://x.test/m.png" medium="image"/>',
      'https://x.test/m.png',
    ],
    [
      '<media:thumbnail url="https://x.test/t.jpg" width="1"/>',
      'https://x.test/t.jpg',
    ],
    [
      '<enclosure url="/media/e.png" type="image/png"/>',
      'https://blog.example.com/media/e.png',
    ],
    [
      '<content:encoded><![CDATA[<p><img src="https://x.test/c.png?a=1&amp;b=2"></p>]]></content:encoded>',
      'https://x.test/c.png?a=1&b=2',
    ],
    [
      '<description>&lt;img src=&quot;https://x.test/d.png&quot;&gt;</description>',
      'https://x.test/d.png',
    ],
    ['<title>No picture</title>', ''],
  ])('reads %s', (block, image) => {
    expect(itemImage(block, base)).toBe(image);
  });

  it('gives each parsed item its picture', () => {
    const { items } = parseFeed(
      '<rss><channel><title>F</title><item><title>T</title><link>https://a.test/1</link><enclosure url="https://a.test/i.png" type="image/png" length="0"/></item></channel></rss>',
      'https://a.test/feed',
    );
    expect(items[0]?.image).toBe('https://a.test/i.png');
  });
});

describe('itemAuthor with several authors', () => {
  it('joins every dc:creator', () => {
    expect(
      itemAuthor('<dc:creator>Ada</dc:creator><dc:creator>Grace</dc:creator>'),
    ).toBe('Ada, Grace');
  });
});
