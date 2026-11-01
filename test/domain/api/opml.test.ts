import { describe, expect, it } from '@jest/globals';

import { buildOpml, escapeXml, parseOpml } from '@/domain/api/opml';

const doc = (body: string) =>
  `<?xml version="1.0"?><opml version="2.0"><body>${body}</body></opml>`;

describe('parseOpml', () => {
  it('reads feeds, using folders as sections', () => {
    const parsed = parseOpml(
      doc(`<outline text="Tech"><outline type="rss" text="HN &amp; Co" xmlUrl="https://a.test/f"/></outline>
        <outline title="Lone" xmlUrl='https://b.test/f'></outline>`),
    );
    expect(parsed).toEqual({
      ok: true,
      feeds: [
        { url: 'https://a.test/f', title: 'HN & Co', section: 'Tech' },
        { url: 'https://b.test/f', title: 'Lone' },
      ],
    });
  });

  it('files nested folders under the top-level one and pops it after', () => {
    const parsed = parseOpml(
      doc(
        `<outline text="A"><outline text="B"><outline xmlUrl="https://a.test/1"/></outline></outline><outline xmlUrl="https://a.test/2"/>`,
      ),
    );
    expect(parsed).toEqual({
      ok: true,
      feeds: [
        { url: 'https://a.test/1', section: 'A' },
        { url: 'https://a.test/2' },
      ],
    });
  });

  it('refuses a document that declares entities', () => {
    expect(parseOpml('<!DOCTYPE x [<!ENTITY a "b">]><opml></opml>').ok).toBe(
      false,
    );
  });

  it('refuses a document that is not OPML', () => {
    expect(parseOpml('<html></html>')).toEqual({
      ok: false,
      errors: ['body: not an OPML document.'],
    });
  });

  it('leaves unknown entities alone', () => {
    expect(
      parseOpml(doc('<outline text="&nope;" xmlUrl="https://a.test/f"/>')),
    ).toMatchObject({
      feeds: [{ title: '&nope;' }],
    });
  });

  it('reads numeric character references', () => {
    expect(
      parseOpml(doc('<outline text="&#65;&#x42;" xmlUrl="https://a.test/f"/>')),
    ).toMatchObject({
      feeds: [{ title: 'AB' }],
    });
  });
});

describe('buildOpml', () => {
  it('groups feeds under their sections and escapes text', () => {
    const xml = buildOpml(
      'T & T',
      [
        { url: 'https://a.test/f?a=1&b=2', title: 'One "1"' },
        { url: 'https://b.test/f', title: 'Two', section: 'News' },
      ],
      ['News', 'Empty'],
    );
    expect(xml).toContain('<title>T &amp; T</title>');
    expect(xml).toContain('xmlUrl="https://a.test/f?a=1&amp;b=2"');
    expect(xml).toContain('<outline text="News">');
    expect(xml).not.toContain('Empty');
    expect(parseOpml(xml)).toEqual({
      ok: true,
      feeds: [
        { url: 'https://a.test/f?a=1&b=2', title: 'One "1"' },
        { url: 'https://b.test/f', title: 'Two', section: 'News' },
      ],
    });
  });
});

describe('escapeXml', () => {
  it('escapes markup characters', () => {
    expect(escapeXml('<a href="x">&')).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;',
    );
  });
});

describe('parseOpml robustness', () => {
  it('reads a tag whose attribute holds a ">"', () => {
    expect(
      parseOpml(doc('<outline text="a > b" xmlUrl="https://a.test/f"/>')),
    ).toEqual({
      ok: true,
      feeds: [{ url: 'https://a.test/f', title: 'a > b' }],
    });
  });

  it('ignores commented-out outlines and CDATA', () => {
    const parsed = parseOpml(
      doc(
        '<!-- <outline xmlUrl="https://a.test/old"/> --><![CDATA[<outline xmlUrl="https://a.test/cd"/>]]><outline xmlUrl="https://a.test/new"/>',
      ),
    );
    expect(parsed).toEqual({
      ok: true,
      feeds: [{ url: 'https://a.test/new' }],
    });
  });

  it('refuses an unterminated comment or tag', () => {
    expect(parseOpml(doc('<!-- never closed')).ok).toBe(false);
    expect(parseOpml(doc('<outline text="open')).ok).toBe(false);
  });

  it('does not take <outlines> for an outline', () => {
    expect(parseOpml(doc('<outlines xmlUrl="https://a.test/f"/>'))).toEqual({
      ok: true,
      feeds: [],
    });
  });

  it('copes with a megabyte of unterminated outlines quickly', () => {
    const started = Date.now();
    parseOpml(doc('<outline text="x'.repeat(60000)));
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('survives deep nesting', () => {
    const depth = 5000;
    const xml = doc(
      '<outline text="F">'.repeat(depth) +
        '<outline xmlUrl="https://a.test/f"/>' +
        '</outline>'.repeat(depth),
    );
    expect(parseOpml(xml)).toEqual({
      ok: true,
      feeds: [{ url: 'https://a.test/f', section: 'F' }],
    });
  });
});

describe('buildOpml site url', () => {
  it('writes htmlUrl when the feed has a website', () => {
    const xml = buildOpml(
      'T',
      [
        {
          url: 'https://a.test/f',
          title: 'A',
          site_url: 'https://a.test/?a=1&b=2',
        },
      ],
      [],
    );
    expect(xml).toContain('htmlUrl="https://a.test/?a=1&amp;b=2"');
    expect(buildOpml('T', [{ url: 'u', title: 'A' }], [])).not.toContain(
      'htmlUrl',
    );
  });
});
