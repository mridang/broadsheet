import { describe, expect, it } from '@jest/globals';

import {
  MAX_FEED_URL_LENGTH,
  feedResource,
  parseFeedId,
  parseFeedInput,
  rfc3339,
} from '@/domain/api/feed-resource';
import type { Feed } from '@/domain/repository';

const stored = (over: Partial<Feed> = {}): Feed => ({
  id: 4,
  user_id: 9,
  url: 'https://a.test/feed.xml',
  title: 'A feed',
  created_at: '2026-01-02 03:04:05',
  ...over,
});

describe('feedResource', () => {
  it('shows the id as a string and leaves the owner out', () => {
    expect(feedResource(stored())).toEqual({
      id: '4',
      url: 'https://a.test/feed.xml',
      title: 'A feed',
      created_at: '2026-01-02T03:04:05Z',
    });
  });

  it('leaves out a timestamp it cannot read', () => {
    expect(feedResource(stored({ created_at: 'soon' }))).not.toHaveProperty(
      'created_at',
    );
  });

  it('leaves out what is unknown instead of sending null', () => {
    expect(feedResource(stored({ title: null, created_at: null }))).toEqual({
      id: '4',
      url: 'https://a.test/feed.xml',
    });
  });
});

describe('rfc3339', () => {
  it('reads SQLite’s UTC timestamp as RFC 3339', () => {
    expect(rfc3339('2026-01-02 03:04:05')).toBe('2026-01-02T03:04:05Z');
  });

  it.each(['', 'yesterday', '2026-13-45 99:99:99', '2026-01-02T03:04:05Z'])(
    'does not know %j',
    (text) => {
      expect(rfc3339(text)).toBeUndefined();
    },
  );
});

describe('parseFeedInput', () => {
  it('accepts an http or https address and trims it', () => {
    expect(parseFeedInput({ url: ' https://a.test/f ' })).toEqual({
      ok: true,
      url: 'https://a.test/f',
    });
    expect(parseFeedInput({ url: 'http://a.test/f' }).ok).toBe(true);
  });

  it.each([
    [{}, 'url: required.'],
    [{ url: 5 }, 'url: required.'],
    [{ url: '   ' }, 'url: required.'],
    [{ url: 'not a url' }, 'url: not a valid address.'],
    [{ url: 'ftp://a.test/f' }, 'url: must be an http or https address.'],
    [
      { url: `https://a.test/${'x'.repeat(MAX_FEED_URL_LENGTH)}` },
      'url: too long.',
    ],
  ])('refuses %j', (body, message) => {
    expect(parseFeedInput(body)).toEqual({ ok: false, errors: [message] });
  });
});

describe('parseFeedId', () => {
  it('reads a whole positive number', () => {
    expect(parseFeedId('12')).toBe(12);
  });

  it.each(['0', '-1', '1.5', 'abc', '', '007', '1'.repeat(30)])(
    'cannot name a feed: %j',
    (raw) => {
      expect(parseFeedId(raw)).toBeUndefined();
    },
  );
});
