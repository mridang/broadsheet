import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import { databaseFrom, type Database } from '@/domain/db/database';
import { Repository } from '@/domain/repository';
import {
  FETCH_FAILED,
  discoverFeed,
  fetchFeed,
  refreshSource,
  scrapeSource,
  withText,
} from '@/domain/scraping/index';
import { APP_MIGRATIONS } from '../../lib/core/db/migrations';
import { sqliteD1 } from '../../lib/core/db/sqlite-d1';

const FEED = `<rss><channel><title>A</title>
  <item><title>Story</title><link>https://a.test/story</link></item>
</channel></rss>`;
const TEXT =
  'The whole story is told right here, at enough length to count as an article and not as a failed extraction.';
const PAGE = `<html><body><article><p>${TEXT}</p></article></body></html>`;

let db: Database;
let sourceId: number;
const env = {} as CloudflareEnv;

/** Every request made, with the headers it sent. */
const requests: { url: string; headers: Record<string, string> }[] = [];

/**
 * Answer every fetch from a table of address to body (or a function making
 * the response); others fail.
 */
function serve(pages: Record<string, string | (() => Response)>): void {
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    requests.push({
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const page = pages[String(input)];
    if (page === undefined) throw new Error('offline');
    return typeof page === 'function' ? page() : new Response(page);
  });
}

/** A redirect to `to` with the given status. */
const redirect = (status: number, to: string) => () =>
  new Response(null, { status, headers: { location: to } });

beforeEach(async () => {
  db = databaseFrom(sqliteD1(...APP_MIGRATIONS).d1);
  sourceId = (await new Repository(db).addFeed(1, 'https://a.test/f'))!
    .source_id;
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  requests.length = 0;
});

const source = async () =>
  (await new Repository(db).allSources()).find((s) => s.id === sourceId)!;

describe('scrapeSource', () => {
  it('stores the edition with the text of each story and records the fetch', async () => {
    serve({ 'https://a.test/f': FEED, 'https://a.test/story': PAGE });
    const result = await scrapeSource(
      db,
      env,
      { id: sourceId, url: 'https://a.test/f' },
      '2026-11-01',
    );
    expect(result).toEqual({ articles: 1 });
    const [article] = await new Repository(db).sourceArticles(
      sourceId,
      '2026-11-01',
    );
    expect(article?.body_text).toBe(TEXT);
    expect(await source()).toMatchObject({ fail_count: 0, last_error: null });
  });

  it('stores what the feed says about itself on the source', async () => {
    serve({ 'https://a.test/f': FEED, 'https://a.test/story': PAGE });
    await scrapeSource(db, env, { id: sourceId, url: 'https://a.test/f' });
    expect(await source()).toMatchObject({
      title: 'A',
      format: 'rss',
      header: JSON.stringify([
        { name: 'title', attributes: {}, text: 'A', children: [] },
      ]),
    });
  });

  it('throws when the feed cannot be fetched, recording nothing', async () => {
    serve({});
    await expect(
      scrapeSource(db, env, { id: sourceId, url: 'https://a.test/f' }),
    ).rejects.toThrow(FETCH_FAILED);
    expect((await source()).fail_count).toBe(0);
  });
});

describe('scrapeSource conditional GET', () => {
  const validated = () => () =>
    new Response(FEED, {
      headers: {
        etag: '"v1"',
        'last-modified': 'Sun, 01 Nov 2026 05:00:00 GMT',
      },
    });

  it('keeps the validators of the answer on the source', async () => {
    serve({ 'https://a.test/f': validated(), 'https://a.test/story': PAGE });
    await scrapeSource(db, env, { id: sourceId, url: 'https://a.test/f' });
    expect(await source()).toMatchObject({
      etag: '"v1"',
      last_modified: 'Sun, 01 Nov 2026 05:00:00 GMT',
    });
  });

  it('asks conditionally once the edition was fetched today, and keeps it on a 304', async () => {
    serve({ 'https://a.test/f': validated(), 'https://a.test/story': PAGE });
    await scrapeSource(
      db,
      env,
      { id: sourceId, url: 'https://a.test/f' },
      '2026-11-01',
    );
    jest.restoreAllMocks();
    requests.length = 0;
    serve({ 'https://a.test/f': () => new Response(null, { status: 304 }) });
    const result = await scrapeSource(
      db,
      env,
      { ...(await source()), last_fetched_at: '2026-11-01 06:00:00' },
      '2026-11-01',
    );
    expect(result).toEqual({ articles: 0 });
    expect(requests[0]?.headers).toMatchObject({
      'if-none-match': '"v1"',
      'if-modified-since': 'Sun, 01 Nov 2026 05:00:00 GMT',
    });
    expect(
      await new Repository(db).sourceArticles(sourceId, '2026-11-01'),
    ).toHaveLength(1);
  });

  it('asks unconditionally for a new day, so the edition is written', async () => {
    serve({ 'https://a.test/f': FEED, 'https://a.test/story': PAGE });
    await scrapeSource(
      db,
      env,
      {
        id: sourceId,
        url: 'https://a.test/f',
        etag: '"v1"',
        last_fetched_at: '2026-10-31 06:00:00',
      },
      '2026-11-01',
    );
    expect(requests[0]?.headers).not.toHaveProperty('if-none-match');
  });
});

describe('scrapeSource answers', () => {
  it('follows a feed that moved for good to its new address', async () => {
    serve({
      'https://a.test/f': redirect(301, 'https://b.test/f'),
      'https://b.test/f': FEED,
      'https://a.test/story': PAGE,
    });
    expect(
      await scrapeSource(db, env, { id: sourceId, url: 'https://a.test/f' }),
    ).toEqual({ articles: 1 });
    expect((await source()).url).toBe('https://b.test/f');
  });

  it('keeps the address through a temporary redirect', async () => {
    serve({
      'https://a.test/f': redirect(302, 'https://b.test/f'),
      'https://b.test/f': FEED,
      'https://a.test/story': PAGE,
    });
    await scrapeSource(db, env, { id: sourceId, url: 'https://a.test/f' });
    expect((await source()).url).toBe('https://a.test/f');
  });

  it.each([
    [404, 'The feed answered HTTP 404.'],
    [410, 'The feed answered HTTP 410.'],
  ])(
    'records an HTTP %i without throwing, so it is not retried',
    async (status, error) => {
      serve({ 'https://a.test/f': () => new Response(null, { status }) });
      expect(
        await scrapeSource(db, env, { id: sourceId, url: 'https://a.test/f' }),
      ).toEqual({ articles: 0, failed: error });
      expect(await source()).toMatchObject({
        fail_count: 1,
        last_error: error,
      });
    },
  );

  it('honours a 429 Retry-After when backing off', async () => {
    serve({
      'https://a.test/f': () =>
        new Response(null, { status: 429, headers: { 'retry-after': '7200' } }),
    });
    await scrapeSource(db, env, { id: sourceId, url: 'https://a.test/f' });
    const next = Date.parse(
      `${(await source()).next_fetch_at!.replace(' ', 'T')}Z`,
    );
    expect(next - Date.now()).toBeGreaterThan(110 * 60 * 1000);
  });

  it('throws on a server error so a retry can try again', async () => {
    serve({ 'https://a.test/f': () => new Response(null, { status: 502 }) });
    await expect(
      scrapeSource(db, env, { id: sourceId, url: 'https://a.test/f' }),
    ).rejects.toThrow('The feed answered HTTP 502.');
    expect((await source()).fail_count).toBe(0);
  });

  it('records a page that is not a feed', async () => {
    serve({ 'https://a.test/f': '<html><body>Hello</body></html>' });
    expect(
      await scrapeSource(db, env, { id: sourceId, url: 'https://a.test/f' }),
    ).toEqual({ articles: 0, failed: 'The address is not a feed.' });
  });
});

describe('fetchFeed', () => {
  it('gives up on an address that redirects too many times', async () => {
    serve({ 'https://a.test/f': redirect(302, 'https://a.test/f') });
    await expect(fetchFeed('https://a.test/f')).rejects.toThrow(
      'The feed redirects too many times.',
    );
  });

  it('reports no move when one redirect on the way was temporary', async () => {
    serve({
      'https://a.test/f': redirect(301, 'https://b.test/f'),
      'https://b.test/f': redirect(307, 'https://c.test/f'),
      'https://c.test/f': FEED,
    });
    expect((await fetchFeed('https://a.test/f')).movedTo).toBeUndefined();
  });
});

describe('discoverFeed', () => {
  it('keeps an address that is already a feed', async () => {
    serve({ 'https://a.test/f': FEED });
    expect(await discoverFeed('https://a.test/f')).toBe('https://a.test/f');
  });

  it('finds the feed a page declares', async () => {
    serve({
      'https://a.test/':
        '<html><head><link rel="alternate" type="application/atom+xml" href="/atom.xml"></head></html>',
      'https://a.test/atom.xml':
        '<feed xmlns="http://www.w3.org/2005/Atom"></feed>',
    });
    expect(await discoverFeed('https://a.test/')).toBe(
      'https://a.test/atom.xml',
    );
  });

  it('tries the usual paths when the page declares none', async () => {
    serve({
      'https://a.test/': '<html><body>No feed here</body></html>',
      'https://a.test/rss': FEED,
    });
    expect(await discoverFeed('https://a.test/')).toBe('https://a.test/rss');
  });

  it('finds nothing on a page with no feed anywhere', async () => {
    serve({ 'https://a.test/': '<html><body>No feed here</body></html>' });
    expect(await discoverFeed('https://a.test/')).toBeUndefined();
  });

  it('keeps an address that cannot be reached, for its first fetch to report', async () => {
    serve({});
    expect(await discoverFeed('https://a.test/f')).toBe('https://a.test/f');
  });
});

describe('withText', () => {
  const article = { id: 0, url: 'https://a.test/story', body_text: null };

  const stored = async () => {
    serve({ 'https://a.test/f': FEED, 'https://a.test/story': '<p>no</p>' });
    await scrapeSource(
      db,
      env,
      { id: sourceId, url: 'https://a.test/f' },
      '2026-11-01',
    );
    jest.restoreAllMocks();
    const [row] = await new Repository(db).sourceArticles(
      sourceId,
      '2026-11-01',
    );
    return row!;
  };

  it('leaves an article that has its text alone', async () => {
    serve({});
    expect(
      await withText(db, { ...article, body_text: 'Kept.' }),
    ).toMatchObject({
      body_text: 'Kept.',
    });
    expect(requests).toHaveLength(0);
  });

  it('fetches and keeps the text the scrape did not', async () => {
    const row = await stored();
    expect(row.body_text).toBeNull();
    serve({ 'https://a.test/story': PAGE });
    expect((await withText(db, row)).body_text).toBe(TEXT);
    const [again] = await new Repository(db).sourceArticles(
      sourceId,
      '2026-11-01',
    );
    expect(again?.body_text).toBe(TEXT);
  });

  it('remembers a page with too little text as having none', async () => {
    const row = await stored();
    serve({ 'https://a.test/story': '<p>Far too short to count.</p>' });
    expect((await withText(db, row)).body_text).toBe('');
  });
});

describe('refreshSource', () => {
  it('records a feed that cannot be fetched as a failure', async () => {
    serve({});
    expect(
      await refreshSource(db, env, { id: sourceId, url: 'https://a.test/f' }),
    ).toEqual({ ok: false, n: 0 });
    expect(await source()).toMatchObject({
      fail_count: 1,
      last_error: FETCH_FAILED,
    });
  });
});
