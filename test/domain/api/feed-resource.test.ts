import { describe, expect, it } from '@jest/globals';

import {
  MAX_FEED_URL_LENGTH,
  feedResource,
  parseFeedChanges,
  sqliteTime,
  parseFeedId,
  parseFeedInput,
  rfc3339,
} from '@/domain/api/feed-resource';
import type { Feed } from '@/domain/repository';

const stored = (over: Partial<Feed> = {}): Feed => ({
  id: 4,
  user_id: 9,
  source_id: 2,
  section_id: null,
  muted: false,
  muted_until: null,
  position: 0,
  url: 'https://a.test/feed.xml',
  title: 'A feed',
  created_at: '2026-01-02 03:04:05',
  icon: null,
  format: null,
  site_url: null,
  description: null,
  language: null,
  feed_updated_at: null,
  update_minutes: null,
  last_fetched_at: null,
  header: null,
  ...over,
});

describe('feedResource', () => {
  it('shows the id as a string and leaves the owner out', () => {
    expect(feedResource(stored())).toEqual({
      id: '4',
      url: 'https://a.test/feed.xml',
      title: 'A feed',
      muted: false,
      position: 0,
      created_at: '2026-01-02T03:04:05Z',
      metadata: [],
    });
  });

  it('carries what the feed says about itself and its whole header', () => {
    const header = [
      { name: 'generator', attributes: {}, text: 'Hugo', children: [] },
    ];
    expect(
      feedResource(
        stored({
          format: 'atom',
          site_url: 'https://a.test/',
          description: 'Notes',
          language: 'en',
          icon: 'https://a.test/i.png',
          feed_updated_at: '2026-10-01T00:00:00.000Z',
          update_minutes: 60,
          last_fetched_at: '2026-10-02 06:00:00',
          header: JSON.stringify(header),
        }),
      ),
    ).toMatchObject({
      format: 'atom',
      site_url: 'https://a.test/',
      description: 'Notes',
      language: 'en',
      icon: 'https://a.test/i.png',
      updated_at: '2026-10-01T00:00:00.000Z',
      update_minutes: 60,
      last_fetched_at: '2026-10-02T06:00:00Z',
      metadata: header,
    });
  });

  it('shows no metadata when the stored header cannot be read', () => {
    expect(feedResource(stored({ header: '{oops' })).metadata).toEqual([]);
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
      muted: false,
      position: 0,
      metadata: [],
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

describe('feedResource of a muted feed filed under a section', () => {
  it('says it is muted and names the section as a string', () => {
    expect(feedResource(stored({ muted: true, section_id: 3 }))).toMatchObject({
      muted: true,
      section_id: '3',
    });
  });
});

describe('parseFeedChanges', () => {
  it.each([
    [{ title: '  Mine  ' }, { title: 'Mine' }],
    [{ title: '   ' }, { title: null }],
    [{ title: null }, { title: null }],
    [{ muted: true }, { muted: true }],
    [{ section_id: '5' }, { section_id: 5 }],
    [{ section_id: null }, { section_id: null }],
    [
      { muted: true, muted_until: '2026-11-08T10:00:00+01:00' },
      { muted: true, muted_until: '2026-11-08 09:00:00' },
    ],
    [{ muted_until: null }, { muted_until: null }],
    [{ position: 4 }, { position: 4 }],
    [{}, {}],
  ])('accepts %j', (body, changes) => {
    expect(parseFeedChanges(body)).toEqual({ ok: true, changes });
  });

  it.each([
    [{ title: 3 }, 'title: must be a string.'],
    [{ title: 'x'.repeat(201) }, 'title: too long.'],
    [{ muted: 'yes' }, 'muted: must be true or false.'],
    [{ section_id: 5 }, 'section_id: not a section id.'],
    [{ section_id: 'abc' }, 'section_id: not a section id.'],
    [{ url: 'https://x' }, 'url: not a member of a feed that can be changed.'],
    [
      { muted_until: 'next week' },
      'muted_until: must be an RFC 3339 date-time.',
    ],
    [
      { muted_until: '2026-11-08' },
      'muted_until: must be an RFC 3339 date-time.',
    ],
    [{ position: -1 }, 'position: must be a whole number from 0 to 10000.'],
    [{ position: 2.5 }, 'position: must be a whole number from 0 to 10000.'],
  ])('refuses %j, naming the field', (body, error) => {
    expect(parseFeedChanges(body)).toEqual({ ok: false, errors: [error] });
  });
});

describe('feedResource of a feed muted for a time', () => {
  it('says when the mute runs out', () => {
    expect(
      feedResource(stored({ muted: true, muted_until: '2026-11-08 09:00:00' })),
    ).toMatchObject({ muted: true, muted_until: '2026-11-08T09:00:00Z' });
  });

  it('leaves the time out once the mute has run out', () => {
    expect(
      feedResource(
        stored({ muted: false, muted_until: '2026-01-01 00:00:00' }),
      ),
    ).not.toHaveProperty('muted_until');
  });

  it('shows where the feed sits in the person’s order', () => {
    expect(feedResource(stored({ position: 7 }))).toMatchObject({
      position: 7,
    });
  });
});

describe('sqliteTime', () => {
  it.each([
    ['2026-11-08T09:00:00Z', '2026-11-08 09:00:00'],
    ['2026-11-08T09:00:00.5Z', '2026-11-08 09:00:00'],
    ['2026-11-08T10:30:00+01:30', '2026-11-08 09:00:00'],
  ])('reads %s as %s', (text, stored) => {
    expect(sqliteTime(text)).toBe(stored);
  });

  it.each(['2026-11-08', '2026-13-40T00:00:00Z', 'soon', ''])(
    'refuses %j',
    (text) => {
      expect(sqliteTime(text)).toBeUndefined();
    },
  );
});
