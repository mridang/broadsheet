import { afterEach, describe, expect, it } from '@jest/globals';

import {
  isCurator,
  parseConversion,
  parseRecommendation,
  rankedSourceResource,
  recommendationResource,
} from '@/domain/api/discover';
import { APP_MIGRATIONS } from '../../lib/core/db/migrations';
import {
  installCloudflareContext,
  sqliteD1,
} from '../../lib/core/db/sqlite-d1';

let restore: (() => void) | undefined;
afterEach(() => restore?.());

describe('rankedSourceResource', () => {
  it('shows the address, title, followers and whether it is followed', () => {
    expect(
      rankedSourceResource({
        id: 1,
        url: 'https://a',
        title: null,
        followers: 2,
        followed: true,
      }),
    ).toEqual({ url: 'https://a', followers: 2, followed: true });
  });
});

describe('parseConversion', () => {
  it('finds the feed of an address', () => {
    expect(parseConversion({ url: 'https://x.substack.com' })).toMatchObject({
      ok: true,
      value: { platform: 'substack' },
    });
  });

  it('builds a Google News feed', () => {
    expect(parseConversion({ google_news: { topic: 'WORLD' } })).toMatchObject({
      ok: true,
      value: { platform: 'google-news' },
    });
  });

  it.each([
    [{}, 'url or google_news: send exactly one.'],
    [{ url: 'a', google_news: {} }, 'url or google_news: send exactly one.'],
    [{ url: 'x', more: 1 }, 'more: not a member of this request.'],
    [{ url: 'ftp://x' }, 'url: not an address a feed can be found for.'],
    [{ url: 3 }, 'url: not an address a feed can be found for.'],
    [{ google_news: 'x' }, expect.stringMatching(/^google_news:/)],
    [{ google_news: {} }, expect.stringMatching(/^google_news:/)],
  ])('refuses %j', (body, error) => {
    const out = parseConversion(body);
    expect(out.ok ? [] : out.errors).toContainEqual(error);
  });
});

describe('parseRecommendation', () => {
  it('accepts an address, a trimmed title and a description', () => {
    expect(
      parseRecommendation({
        url: 'https://a/f',
        title: ' A ',
        description: ' Good ',
      }),
    ).toEqual({
      ok: true,
      value: { url: 'https://a/f', title: 'A', description: 'Good' },
    });
  });

  it.each([
    [{ url: 'x', description: 'd' }, 'url: an http(s) address.'],
    [
      { url: 'https://a', description: ' ' },
      'description: from 1 to 1000 characters.',
    ],
    [
      { url: 'https://a', description: 'd', title: 3 },
      'title: at most 200 characters.',
    ],
    [
      { url: 'https://a', description: 'd', x: 1 },
      'x: not a member of this request.',
    ],
  ])('refuses %j', (body, error) => {
    const out = parseRecommendation(body);
    expect(out.ok ? [] : out.errors).toContainEqual(error);
  });
});

describe('recommendationResource', () => {
  it('shows a recommendation with RFC 3339 times', () => {
    expect(
      recommendationResource({
        id: 4,
        user_id: 1,
        url: 'https://a',
        title: null,
        description: 'd',
        status: 'approved',
        created_at: '2026-11-01 10:00:00',
        decided_at: '2026-11-01 11:00:00',
      }),
    ).toEqual({
      id: '4',
      url: 'https://a',
      description: 'd',
      status: 'approved',
      created_at: '2026-11-01T10:00:00Z',
      decided_at: '2026-11-01T11:00:00Z',
    });
  });
});

describe('isCurator', () => {
  it('knows the curators by CURATOR_EMAILS, ignoring case and spaces', () => {
    restore = installCloudflareContext(sqliteD1(...APP_MIGRATIONS).d1, {
      CURATOR_EMAILS: 'Ed@x.test, other@x.test',
    });
    expect(isCurator({ email: 'ed@X.test' })).toBe(true);
    expect(isCurator({ email: 'reader@x.test' })).toBe(false);
  });

  it('knows none when CURATOR_EMAILS is not set', () => {
    restore = installCloudflareContext(sqliteD1(...APP_MIGRATIONS).d1, {});
    expect(isCurator({ email: 'ed@x.test' })).toBe(false);
  });
});
