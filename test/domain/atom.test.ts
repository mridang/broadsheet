import { describe, expect, it } from '@jest/globals';

import { atomXml, escapeXml } from '@/domain/atom';

describe('escapeXml', () => {
  it('escapes markup and drops characters XML cannot carry', () => {
    expect(escapeXml(`<a href="x">'&'</a>\u0001`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;',
    );
  });
});

describe('atomXml', () => {
  it('writes the feed and its entries, leaving out what an entry lacks', () => {
    const xml = atomXml({
      id: 'urn:f',
      title: 'Saved & kept',
      self: 'https://p/feed.xml',
      site: 'https://p',
      updated: '2026-10-02T00:00:00Z',
      entries: [
        {
          id: 'urn:1',
          title: 'One',
          url: 'https://x/1?a=1&b=2',
          updated: '2026-10-02T00:00:00Z',
          summary: 'Sum',
          source: 'X',
        },
        {
          id: 'urn:2',
          title: 'Two',
          url: 'https://x/2',
          updated: '2026-10-01T00:00:00Z',
        },
      ],
    });
    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom">');
    expect(xml).toContain('<title>Saved &amp; kept</title>');
    expect(xml).toContain(
      '<link rel="alternate" href="https://x/1?a=1&amp;b=2"/>',
    );
    expect(xml).toContain('<author><name>X</name></author>');
    expect(xml.match(/<entry>/g)).toHaveLength(2);
    expect(xml.match(/<summary>/g)).toHaveLength(1);
  });
});

describe('atomXml content and categories', () => {
  it('writes an entry’s text and its categories, escaped', () => {
    const xml = atomXml({
      id: 'urn:f',
      title: 'F',
      self: 'https://p/feed.xml',
      site: 'https://p',
      updated: '2026-10-02T00:00:00Z',
      entries: [
        {
          id: 'urn:1',
          title: 'One',
          url: 'https://x/1',
          updated: '2026-10-02T00:00:00Z',
          content: 'a < b',
          categories: ['c&d'],
        },
      ],
    });
    expect(xml).toContain('<content type="text">a &lt; b</content>');
    expect(xml).toContain('<category term="c&amp;d"/>');
  });
});

describe('escapeXml control characters', () => {
  const FORBIDDEN = new RegExp(
    String.raw`[\u0000-\u0008\u000B\u000C\u000E-\u001F]`,
    'g',
  );

  it('drops exactly the control characters XML 1.0 cannot carry', () => {
    for (let code = 0; code < 0x80; code += 1) {
      const text = `a${String.fromCodePoint(code)}b`;
      expect(escapeXml(text)).toBe(escapeXml(text.replaceAll(FORBIDDEN, '')));
    }
    expect(escapeXml('a\tb\nc\rd')).toBe('a\tb\nc\rd');
    expect(escapeXml('a\u0000\u000B\u001Fb')).toBe('ab');
  });
});
