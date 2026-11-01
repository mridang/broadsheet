import { describe, expect, it } from '@jest/globals';

import {
  elementLabel,
  formatName,
  updateFrequency,
} from '@/domain/render/feed-details';

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
