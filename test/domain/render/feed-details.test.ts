import { describe, expect, it } from '@jest/globals';

import {
  elementLabel,
  formatName,
  headerFacts,
  headerImage,
  updateFrequency,
} from '@/domain/render/feed-details';
import type { FeedElement } from '@/lib/scraping';

describe('elementLabel', () => {
  it.each([
    ['lastBuildDate', 'Last built'],
    ['generator', 'Generator'],
    ['managingEditor', 'Managing editor'],
    ['sy:updatePeriod', 'Update period (Syndication)'],
    ['atom:link', 'Link (Atom)'],
    ['foo:barBaz', 'Bar baz (foo)'],
    ['last-modified', 'Last modified'],
  ])('labels %s as %s', (name, label) => {
    expect(elementLabel(name)).toBe(label);
  });
});

describe('updateFrequency', () => {
  it.each([
    [30, 'every 30 minutes'],
    [1, 'every 1 minute'],
    [60, 'hourly'],
    [120, 'every 2 hours'],
    [1440, 'daily'],
    [2880, 'every 2 days'],
    [10080, 'weekly'],
  ])('words %i minutes as %s', (minutes, text) => {
    expect(updateFrequency(minutes)).toBe(text);
  });
});

describe('formatName', () => {
  it.each([
    ['rss', 'RSS'],
    ['atom', 'Atom'],
    ['rdf', 'RSS 1.0 (RDF)'],
    ['other', 'other'],
  ])('names %s as %s', (format, name) => {
    expect(formatName(format)).toBe(name);
  });
});

const el = (
  name: string,
  text = '',
  attributes: Record<string, string> = {},
  children: FeedElement[] = [],
): FeedElement => ({ name, text, attributes, children });

describe('headerFacts', () => {
  it('reads every element but the ones the summary shows, joining repeats', () => {
    expect(
      headerFacts([
        el('title', 'T'),
        el('generator', 'https://wordpress.org/?v=7.1.4'),
        el('sy:updatePeriod', 'hourly'),
        el('category', 'Tech'),
        el('category', 'Ops'),
        el('copyright', '© GitHub'),
        el('cloud', '', { domain: 'rpc.test', port: '80' }),
        el('author', '', {}, [el('name', 'Ann'), el('email', 'a@b.test')]),
        el('skipHours', '', {}, [el('hour', '1'), el('hour', '2')]),
        el('atom:link', '', { rel: 'self', href: 'https://a.test/f' }),
      ]),
    ).toEqual([
      { label: 'Generator', value: 'https://wordpress.org/?v=7.1.4' },
      { label: 'Update period (Syndication)', value: 'hourly' },
      { label: 'Category', value: 'Tech, Ops' },
      { label: 'Copyright', value: '© GitHub' },
      { label: 'Cloud', value: 'domain rpc.test · port 80' },
      { label: 'Author', value: 'Ann · a@b.test' },
      { label: 'Skipped hours', value: '1 · 2' },
      { label: 'Link (Atom)', value: 'rel self · href https://a.test/f' },
    ]);
  });
});

describe('headerImage', () => {
  it('reads the RSS image block, else an Atom logo or icon', () => {
    expect(
      headerImage([
        el('image', '', {}, [
          el('url', 'https://a.test/i.png'),
          el('title', 'A'),
          el('link', 'https://a.test/'),
        ]),
      ]),
    ).toEqual({
      url: 'https://a.test/i.png',
      title: 'A',
      link: 'https://a.test/',
    });
    expect(headerImage([el('logo', 'https://a.test/l.png')])).toEqual({
      url: 'https://a.test/l.png',
      title: '',
      link: '',
    });
    expect(headerImage([el('title', 'x')])).toBeUndefined();
  });
});
