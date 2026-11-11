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
import { createHmac } from 'node:crypto';

import { sql } from 'drizzle-orm';

import {
  FETCH_FAILED,
  acceptPush,
  discoverFeed,
  fetchFeed,
  refreshSource,
  scrapeSource,
  withText,
} from '@/domain/scraping/index';
import { verifyIntent } from '@/domain/websub';
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
function serve(
  pages: Record<
    string,
    string | ((headers: Record<string, string>) => Response)
  >,
): void {
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    requests.push({
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const page = pages[String(input)];
    if (page === undefined) throw new Error('offline');
    return typeof page === 'function'
      ? page((init?.headers ?? {}) as Record<string, string>)
      : new Response(page);
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

  it('times each fetch in the history, a failed one too', async () => {
    serve({ 'https://a.test/f': FEED, 'https://a.test/story': PAGE });
    await scrapeSource(db, env, { id: sourceId, url: 'https://a.test/f' });
    serve({});
    await refreshSource(db, env, { id: sourceId, url: 'https://a.test/f' });
    const feed = (await new Repository(db).listFeeds(1))[0]!;
    const history = (await new Repository(db).feedStatistics(1, feed.id))!
      .fetch_history;
    expect(history.map((h) => [h.ok, typeof h.duration_ms])).toEqual([
      [false, 'number'],
      [true, 'number'],
    ]);
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
      () => 0.5,
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

describe('scrapeSource fetching', () => {
  it('asks once more as a browser after an error answer', async () => {
    serve({
      'https://a.test/f': (headers) =>
        headers['user-agent']?.includes('Chrome')
          ? new Response(FEED)
          : new Response(null, { status: 403 }),
      'https://a.test/story': PAGE,
    });
    expect(
      await scrapeSource(db, env, { id: sourceId, url: 'https://a.test/f' }),
    ).toEqual({ articles: 1 });
  });

  it('does not ask again after a 429', async () => {
    serve({ 'https://a.test/f': () => new Response(null, { status: 429 }) });
    await scrapeSource(db, env, { id: sourceId, url: 'https://a.test/f' });
    expect(requests).toHaveLength(1);
  });

  it('now and then asks without validators, to catch servers that never change them', async () => {
    serve({ 'https://a.test/f': FEED, 'https://a.test/story': PAGE });
    await scrapeSource(
      db,
      env,
      {
        id: sourceId,
        url: 'https://a.test/f',
        etag: '"v1"',
        last_fetched_at: '2026-11-01 06:00:00',
      },
      '2026-11-01',
      () => 0,
    );
    expect(requests[0]?.headers).not.toHaveProperty('if-none-match');
  });

  it('looks for a never-fetched feed from its site when its address fails', async () => {
    serve({
      'https://a.test/old.xml': () => new Response(null, { status: 404 }),
      'https://a.test/':
        '<html><head><link rel="alternate" type="application/rss+xml" href="/new.xml"></head></html>',
      'https://a.test/new.xml': FEED,
      'https://a.test/story': PAGE,
    });
    await new Repository(db).moveSource(sourceId, 'https://a.test/old.xml');
    expect(
      await scrapeSource(db, env, {
        id: sourceId,
        url: 'https://a.test/old.xml',
      }),
    ).toEqual({ articles: 1 });
    expect((await source()).url).toBe('https://a.test/new.xml');
  });

  it('does not look again for a feed that has worked before', async () => {
    serve({ 'https://a.test/f': () => new Response(null, { status: 404 }) });
    await scrapeSource(db, env, {
      id: sourceId,
      url: 'https://a.test/f',
      last_fetched_at: '2026-10-01 06:00:00',
    });
    expect(requests.map((r) => r.url)).toEqual([
      'https://a.test/f',
      'https://a.test/f',
    ]);
  });

  /** Minutes from now until the source is due again. */
  const minutesAway = async () => {
    const next = (await source()).next_fetch_at!;
    return (Date.parse(`${next.replace(' ', 'T')}Z`) - Date.now()) / 60_000;
  };

  it('schedules the next fetch from how busy the feed is', async () => {
    serve({ 'https://a.test/f': FEED, 'https://a.test/story': PAGE });
    await scrapeSource(
      db,
      env,
      { id: sourceId, url: 'https://a.test/f' },
      '2026-11-01',
      () => 0,
    );
    // One story this month for one follower is 348 minutes, capped at four
    // hours while anyone follows the feed.
    expect(Math.round(await minutesAway())).toBe(240);
  });

  it('waits as long as Cache-Control max-age asks instead', async () => {
    serve({
      'https://a.test/f': () =>
        new Response(FEED, { headers: { 'cache-control': 'max-age=1200' } }),
      'https://a.test/story': PAGE,
    });
    await scrapeSource(db, env, { id: sourceId, url: 'https://a.test/f' });
    expect(Math.round(await minutesAway())).toBe(20);
  });

  it('stores a story the feed lists twice once', async () => {
    const twice = `<rss><channel><title>A</title>
      <item><title>Story</title><link>https://a.test/story</link><guid>1</guid></item>
      <item><title>Story</title><link>https://a.test/story?utm=x</link><guid>1</guid></item>
    </channel></rss>`;
    serve({ 'https://a.test/f': twice, 'https://a.test/story': PAGE });
    expect(
      await scrapeSource(db, env, { id: sourceId, url: 'https://a.test/f' }),
    ).toEqual({ articles: 1 });
  });
});

const HUB_FEED = `<rss><channel><title>A</title>
  <atom:link rel="hub" href="https://hub.test/"/>
  <item><title>Story</title><link>https://a.test/story</link></item>
</channel></rss>`;

/** Answer the feed with a hub and accept every subscription. */
function serveHub(): void {
  serve({
    'https://a.test/f': HUB_FEED,
    'https://a.test/story': PAGE,
    'https://hub.test/': () => new Response(null, { status: 202 }),
  });
}

const hubCalls = () =>
  requests.filter((r) => r.url === 'https://hub.test/').length;

describe('WebSub', () => {
  it('subscribes a feed at the hub it names', async () => {
    serveHub();
    await scrapeSource(db, env, { id: sourceId, url: 'https://a.test/f' });
    expect(hubCalls()).toBe(1);
    expect(await source()).toMatchObject({
      websub_hub: 'https://hub.test/',
      websub_topic: 'https://a.test/f',
    });
  });

  it('does not ask again while the lease has days to run', async () => {
    serveHub();
    await scrapeSource(db, env, { id: sourceId, url: 'https://a.test/f' });
    await verifyIntent(
      db,
      sourceId,
      new URLSearchParams({
        'hub.mode': 'subscribe',
        'hub.topic': 'https://a.test/f',
        'hub.challenge': 'c',
      }),
    );
    await scrapeSource(db, env, { id: sourceId, url: 'https://a.test/f' });
    expect(hubCalls()).toBe(1);
  });

  it('still stores the feed when the hub cannot be reached', async () => {
    serve({ 'https://a.test/f': HUB_FEED, 'https://a.test/story': PAGE });
    expect(
      await scrapeSource(db, env, { id: sourceId, url: 'https://a.test/f' }),
    ).toEqual({ articles: 1 });
  });

  const PUSHED = `<rss><channel><title>A</title>
    <item><title>New</title><link>https://a.test/new</link></item>
  </channel></rss>`;
  const signed = async (body: string) => {
    const secret = (await source()).websub_secret!;
    return `sha1=${createHmac('sha1', secret).update(body).digest('hex')}`;
  };

  it('adds a signed push to the edition as a fetch, keeping what was there', async () => {
    serveHub();
    await scrapeSource(
      db,
      env,
      { id: sourceId, url: 'https://a.test/f' },
      '2026-11-01',
    );
    const body = new TextEncoder().encode(PUSHED);
    expect(
      await acceptPush(
        db,
        env,
        sourceId,
        body,
        await signed(PUSHED),
        '2026-11-01',
      ),
    ).toBe('accepted');
    const urls = (
      await new Repository(db).sourceArticles(sourceId, '2026-11-01')
    ).map((a) => a.url);
    expect(urls.toSorted()).toEqual([
      'https://a.test/new',
      'https://a.test/story',
    ]);
  });

  it('ignores a push whose signature does not match', async () => {
    serveHub();
    await scrapeSource(
      db,
      env,
      { id: sourceId, url: 'https://a.test/f' },
      '2026-11-01',
    );
    const body = new TextEncoder().encode(PUSHED);
    expect(
      await acceptPush(db, env, sourceId, body, 'sha1=00', '2026-11-01'),
    ).toBe('unsigned');
    expect(
      await new Repository(db).sourceArticles(sourceId, '2026-11-01'),
    ).toHaveLength(1);
  });

  it('refuses a push for a source with no subscription', async () => {
    expect(await acceptPush(db, env, sourceId, new Uint8Array(), null)).toBe(
      'unknown',
    );
  });
});

describe('notified feeds', () => {
  it('are due again within 30 minutes', async () => {
    const feed = (await new Repository(db).listFeeds(1))[0]!;
    await db.run(
      sql`INSERT INTO feed_notifications (user_id, subscription_id) VALUES (1, ${feed.id})`,
    );
    serve({ 'https://a.test/f': FEED, 'https://a.test/story': PAGE });
    await scrapeSource(db, env, { id: sourceId, url: 'https://a.test/f' });
    const next = Date.parse(
      `${(await source()).next_fetch_at!.replace(' ', 'T')}Z`,
    );
    expect(next - Date.now()).toBeLessThanOrEqual(30 * 60 * 1000);
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
  const article = {
    id: 0,
    url: 'https://a.test/story',
    body_text: null,
    image: null,
  };

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

  it('takes the page’s lead picture for a story with none', async () => {
    const row = await stored();
    serve({
      'https://a.test/story': `<html><head><meta property="og:image" content="/lead.jpg"></head><body><p>${TEXT}</p></body></html>`,
    });
    expect((await withText(db, row)).image).toBe('https://a.test/lead.jpg');
  });

  it('fetches the text again when forced', async () => {
    const row = await stored();
    serve({ 'https://a.test/story': PAGE });
    expect(
      (await withText(db, { ...row, body_text: 'Old.' }, true)).body_text,
    ).toBe(TEXT);
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
