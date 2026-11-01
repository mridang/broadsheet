import { describe, expect, it } from '@jest/globals';

import {
  feedCandidates,
  feedScore,
  isFeed,
  retryAfterMinutes,
} from '@/lib/scraping';

describe('isFeed', () => {
  it.each([
    ['<?xml version="1.0"?><rss version="2.0">', true],
    ['<feed xmlns="http://www.w3.org/2005/Atom">', true],
    ['<rdf:RDF xmlns:rdf="x">', true],
    ['{"version": "https://jsonfeed.org/version/1.1"}', true],
    [
      '<!doctype html><html><head><link rel="alternate" type="application/rss+xml">',
      false,
    ],
    ['', false],
  ])('tells a feed from a page: %s', (body, expected) => {
    expect(isFeed(body)).toBe(expected);
  });
});

describe('feedScore', () => {
  it('ranks Atom over RSS over RDF, and comment feeds last', () => {
    expect(feedScore('/atom.xml')).toBeGreaterThan(feedScore('/rss.xml'));
    expect(feedScore('/rss')).toBeGreaterThan(feedScore('/index.rdf'));
    expect(feedScore('/comments/feed')).toBeLessThan(feedScore('/feed'));
  });
});

describe('feedCandidates', () => {
  it('puts declared feeds first, then same-site feed links by rank, then the usual paths', () => {
    const html = `<head>
      <link rel="alternate" type="application/rss+xml" href="/posts.rss">
      <link rel="stylesheet" href="/style.css">
      <link rel="alternate" type="text/html" hreflang="fr" href="/fr/">
    </head><body>
      <a href="/comments/feed">comments</a>
      <a href="https://elsewhere.test/atom.xml">other site</a>
      <a href="/atom.xml">atom</a>
      <a href="/about">about</a>
    </body>`;
    const found = feedCandidates(html, 'https://a.test/blog/');
    expect(found.slice(0, 3)).toEqual([
      'https://a.test/posts.rss',
      'https://a.test/atom.xml',
      'https://a.test/comments/feed',
    ]);
    expect(found).toContain('https://a.test/rss.xml');
    expect(found).not.toContain('https://elsewhere.test/atom.xml');
    expect(new Set(found).size).toBe(found.length);
  });

  it('skips addresses that are not http(s)', () => {
    const html =
      '<link rel="alternate" type="application/rss+xml" href="javascript:alert(1)">';
    expect(feedCandidates(html, 'https://a.test/')[0]).toBe(
      'https://a.test/feed',
    );
  });
});

describe('retryAfterMinutes', () => {
  const now = Date.parse('2026-11-01T06:00:00Z');

  it('reads seconds and HTTP dates, rounding up to whole minutes', () => {
    expect(retryAfterMinutes('90', now)).toBe(2);
    expect(retryAfterMinutes('Sun, 01 Nov 2026 07:00:00 GMT', now)).toBe(60);
  });

  it('is never negative, and undefined when absent or unreadable', () => {
    expect(retryAfterMinutes('Sun, 01 Nov 2026 05:00:00 GMT', now)).toBe(0);
    expect(retryAfterMinutes(null, now)).toBeUndefined();
    expect(retryAfterMinutes('soon', now)).toBeUndefined();
  });
});
