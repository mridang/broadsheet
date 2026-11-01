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
  refreshSource,
  scrapeSource,
} from '@/domain/scraping/index';
import { APP_MIGRATIONS } from '../../lib/core/db/migrations';
import { sqliteD1 } from '../../lib/core/db/sqlite-d1';

const FEED = `<rss><channel><title>A</title>
  <item><title>Story</title><link>https://a.test/story</link></item>
</channel></rss>`;
const PAGE =
  '<html><body><article><p>The whole story is told right here.</p></article></body></html>';

let db: Database;
let sourceId: number;
const env = {} as CloudflareEnv;

/** Answer every fetch from a table of address to body; others fail. */
function serve(pages: Record<string, string>): void {
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const body = pages[String(input)];
    if (body === undefined) throw new Error('offline');
    return new Response(body);
  });
}

beforeEach(async () => {
  db = databaseFrom(sqliteD1(...APP_MIGRATIONS).d1);
  sourceId = (await new Repository(db).addFeed(1, 'https://a.test/f'))!
    .source_id;
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const source = async () =>
  (await new Repository(db).allSources()).find((s) => s.id === sourceId)!;

describe('scrapeSource', () => {
  it('stores the edition with the text of each story and records the fetch', async () => {
    serve({ 'https://a.test/f': FEED, 'https://a.test/story': PAGE });
    const n = await scrapeSource(
      db,
      env,
      { id: sourceId, url: 'https://a.test/f' },
      '2026-11-01',
    );
    expect(n).toBe(1);
    const [article] = await new Repository(db).sourceArticles(
      sourceId,
      '2026-11-01',
    );
    expect(article?.body_text).toBe('The whole story is told right here.');
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
