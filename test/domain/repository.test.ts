import { beforeEach, describe, expect, it } from '@jest/globals';
import { sql } from 'drizzle-orm';

import { databaseFrom, type Database } from '@/domain/db/database';
import {
  anyWordQuery,
  FETCH_HISTORY_LIMIT,
  DEFAULT_PREFERENCES,
  conversationTitle,
  ftsQuery,
  MAX_BACKOFF_MINUTES,
  Repository,
  autoMarkReadDays,
  filedIn,
  sectionAndDescendants,
  sectionNames,
  sectionPath,
  treeOrder,
  type Profile,
  type Section,
} from '@/domain/repository';
import type { ScrapedItem } from '@/lib/scraping';
import { APP_MIGRATIONS } from '../lib/core/db/migrations';
import { sqliteD1 } from '../lib/core/db/sqlite-d1';

// Thin adapters over the Repository handle, so each case reads as a one-liner.
const upsertUser = (d: Database, p: Profile) => new Repository(d).upsertUser(p);
const getUser = (d: Database, id: number) => new Repository(d).getUser(id);
const getSessionEpoch = (d: Database, id: number) =>
  new Repository(d).getSessionEpoch(id);
const bumpSessionEpoch = (d: Database, id: number) =>
  new Repository(d).bumpSessionEpoch(id);
const listFeeds = (d: Database, userId: number) =>
  new Repository(d).listFeeds(userId);
const addFeed = (d: Database, userId: number, url: string, title?: string) =>
  new Repository(d).addFeed(userId, url, title);
const getFeedByUrl = (d: Database, userId: number, url: string) =>
  new Repository(d).getFeedByUrl(userId, url);
const removeFeed = (d: Database, userId: number, id: number) =>
  new Repository(d).removeFeed(userId, id);

let db: Database;

beforeEach(() => {
  db = databaseFrom(sqliteD1(...APP_MIGRATIONS).d1);
});

describe('upsertUser', () => {
  it('creates a person with no name or picture when Google gave none', async () => {
    const user = await upsertUser(db, { sub: 'g1', email: 'a@b.com' });
    expect(user).toMatchObject({
      google_sub: 'g1',
      email: 'a@b.com',
      name: null,
      picture: null,
      session_epoch: 0,
    });
  });

  it('refreshes the profile of a returning person without touching their id or epoch', async () => {
    const first = await upsertUser(db, {
      sub: 'g1',
      email: 'a@b.com',
      name: 'A',
    });
    await bumpSessionEpoch(db, first.id);
    const again = await upsertUser(db, {
      sub: 'g1',
      email: 'c@d.com',
      name: 'C',
      picture: 'https://p/c',
    });
    expect(again).toMatchObject({
      id: first.id,
      email: 'c@d.com',
      name: 'C',
      picture: 'https://p/c',
      session_epoch: 1,
    });
  });
});

describe('getUser', () => {
  it('finds a person by id, or nothing', async () => {
    const { id } = await upsertUser(db, { sub: 'g1', email: 'a@b.com' });
    expect((await getUser(db, id))?.email).toBe('a@b.com');
    expect(await getUser(db, id + 1)).toBeUndefined();
  });
});

describe('getSessionEpoch and bumpSessionEpoch', () => {
  it('read the epoch and move only that person’s on by one', async () => {
    const a = await upsertUser(db, { sub: 'g1', email: 'a@b.com' });
    const b = await upsertUser(db, { sub: 'g2', email: 'c@d.com' });
    await bumpSessionEpoch(db, a.id);
    await bumpSessionEpoch(db, a.id);
    expect(await getSessionEpoch(db, a.id)).toBe(2);
    expect(await getSessionEpoch(db, b.id)).toBe(0);
  });

  it('say nothing for an account that is gone', async () => {
    expect(await getSessionEpoch(db, 99)).toBeUndefined();
  });
});

describe('getFeedByUrl and removeFeed', () => {
  it('finds a feed by address, for its owner only', async () => {
    const feed = (await addFeed(db, 1, 'https://a.test/f'))!;
    expect(await getFeedByUrl(db, 1, feed.url)).toMatchObject({ id: feed.id });
    expect(await getFeedByUrl(db, 2, feed.url)).toBeUndefined();
  });

  it('says whether there was a feed to remove, and removes only the caller’s', async () => {
    const feed = (await addFeed(db, 1, 'https://a.test/f'))!;
    expect(await removeFeed(db, 2, feed.id)).toBe(false);
    expect(await listFeeds(db, 1)).toHaveLength(1);
    expect(await removeFeed(db, 1, feed.id)).toBe(true);
    expect(await removeFeed(db, 1, feed.id)).toBe(false);
    expect(await listFeeds(db, 1)).toHaveLength(0);
  });
});

describe('addFeed', () => {
  it('shares one source between everyone who follows an address', async () => {
    const a = (await addFeed(db, 1, 'https://a.test/f', 'A'))!;
    const b = (await addFeed(db, 2, 'https://a.test/f'))!;
    expect(b.source_id).toBe(a.source_id);
    expect(b.id).not.toBe(a.id);
    expect(b.title).toBe('A');
    expect(await new Repository(db).allSources()).toHaveLength(1);
  });

  it('starts a feed unmuted and under no section', async () => {
    expect(await addFeed(db, 1, 'https://a.test/f')).toMatchObject({
      muted: false,
      section_id: null,
    });
  });
});

describe('updateFeed', () => {
  it('renames, mutes and files only the caller’s feed', async () => {
    const repo = new Repository(db);
    const feed = (await addFeed(db, 1, 'https://a.test/f', 'A'))!;
    const section = await repo.addSection(1, 'Tech');
    expect(
      await repo.updateFeed(1, feed.id, {
        title: 'Mine',
        muted: true,
        section_id: section.id,
      }),
    ).toMatchObject({ title: 'Mine', muted: true, section_id: section.id });
    expect(await repo.updateFeed(2, feed.id, { muted: false })).toBeUndefined();
    expect((await repo.getFeed(1, feed.id))?.muted).toBe(true);
  });

  it('goes back to the source’s own title when the title is cleared', async () => {
    const repo = new Repository(db);
    const feed = (await addFeed(db, 1, 'https://a.test/f', 'A'))!;
    await repo.updateFeed(1, feed.id, { title: 'Mine' });
    expect((await repo.updateFeed(1, feed.id, { title: null }))?.title).toBe(
      'A',
    );
  });
});

describe('sections', () => {
  it('adds sections after the others and lists them in order', async () => {
    const repo = new Repository(db);
    await repo.addSection(1, 'B', 5);
    await repo.addSection(1, 'A', 2);
    await repo.addSection(1, 'C');
    await repo.addSection(2, 'Other');
    expect(
      (await repo.listSections(1)).map((s) => [s.name, s.position]),
    ).toEqual([
      ['A', 2],
      ['B', 5],
      ['C', 6],
    ]);
  });

  it('renames or moves only the caller’s section', async () => {
    const repo = new Repository(db);
    const s = await repo.addSection(1, 'A');
    expect(
      await repo.updateSection(1, s.id, { name: 'Z', position: 4 }),
    ).toMatchObject({
      name: 'Z',
      position: 4,
    });
    expect(await repo.updateSection(2, s.id, { name: 'Q' })).toBeUndefined();
  });

  it('removes a section, leaving its feeds under no section', async () => {
    const repo = new Repository(db);
    const s = await repo.addSection(1, 'A');
    const feed = (await addFeed(db, 1, 'https://a.test/f'))!;
    await repo.updateFeed(1, feed.id, { section_id: s.id });
    expect(await repo.removeSection(2, s.id)).toBe(false);
    expect(await repo.removeSection(1, s.id)).toBe(true);
    expect(await repo.removeSection(1, s.id)).toBe(false);
    expect((await repo.getFeed(1, feed.id))?.section_id).toBeNull();
  });
});

describe('recordFetch', () => {
  it('counts failures in a row and clears them on success', async () => {
    const repo = new Repository(db);
    const { source_id } = (await addFeed(db, 1, 'https://a.test/f'))!;
    await repo.recordFetch(source_id, 'down');
    await repo.recordFetch(source_id, 'down');
    expect((await repo.allSources())[0]).toMatchObject({
      last_error: 'down',
      fail_count: 2,
      last_fetched_at: null,
    });
    await repo.recordFetch(source_id);
    const [source] = await repo.allSources();
    expect(source).toMatchObject({ last_error: null, fail_count: 0 });
    expect(source?.last_fetched_at).toEqual(expect.any(String));
  });

  /** Minutes from now until the source may be fetched again. */
  const minutesAway = async (repo: Repository) => {
    const next = (await repo.allSources())[0]!.next_fetch_at!;
    return (Date.parse(`${next.replace(' ', 'T')}Z`) - Date.now()) / 60000;
  };

  it('backs a failing source off a day for each failure before, up to a week', async () => {
    const repo = new Repository(db);
    const { source_id } = (await addFeed(db, 1, 'https://a.test/f'))!;
    await repo.recordFetch(source_id, 'down');
    expect(await minutesAway(repo)).toBeLessThan(1);
    await repo.recordFetch(source_id, 'down');
    expect(Math.round(await minutesAway(repo))).toBe(1440);
    for (let i = 0; i < 10; i++) await repo.recordFetch(source_id, 'down');
    expect(Math.round(await minutesAway(repo))).toBe(MAX_BACKOFF_MINUTES);
  });

  it('waits as long as the server asked when that is longer', async () => {
    const repo = new Repository(db);
    const { source_id } = (await addFeed(db, 1, 'https://a.test/f'))!;
    await repo.recordFetch(source_id, { error: 'busy', retryAfter: 120 });
    expect(Math.round(await minutesAway(repo))).toBe(120);
  });

  it('schedules a success the given minutes ahead', async () => {
    const repo = new Repository(db);
    const { source_id } = (await addFeed(db, 1, 'https://a.test/f'))!;
    await repo.recordFetch(source_id, { nextFetch: 45 });
    expect(Math.round(await minutesAway(repo))).toBe(45);
  });

  it('keeps the validators of a success and clears the backoff', async () => {
    const repo = new Repository(db);
    const { source_id } = (await addFeed(db, 1, 'https://a.test/f'))!;
    await repo.recordFetch(source_id, 'down');
    await repo.recordFetch(source_id, { etag: '"x"', lastModified: 'then' });
    expect((await repo.allSources())[0]).toMatchObject({
      etag: '"x"',
      last_modified: 'then',
      next_fetch_at: null,
    });
  });
});

describe('dueSources', () => {
  it('leaves out a source backed off past the next hour', async () => {
    const repo = new Repository(db);
    const { source_id } = (await addFeed(db, 1, 'https://a.test/f'))!;
    await repo.recordFetch(source_id, 'down');
    expect(await repo.dueSources()).toHaveLength(1);
    await repo.recordFetch(source_id, 'down');
    expect(await repo.dueSources()).toEqual([]);
  });
});

describe('moveSource', () => {
  it('moves a source to its new address and forgets its validators', async () => {
    const repo = new Repository(db);
    const { source_id } = (await addFeed(db, 1, 'https://a.test/f'))!;
    await repo.recordFetch(source_id, { etag: '"x"' });
    expect(await repo.moveSource(source_id, 'https://b.test/f')).toBe(
      source_id,
    );
    expect((await repo.allSources())[0]).toMatchObject({
      url: 'https://b.test/f',
      etag: null,
    });
  });

  it('merges into the source that already has the address', async () => {
    const repo = new Repository(db);
    const { source_id } = (await addFeed(db, 1, 'https://a.test/f'))!;
    await addFeed(db, 2, 'https://a.test/f');
    const other = (await addFeed(db, 2, 'https://b.test/f'))!.source_id;
    expect(await repo.moveSource(source_id, 'https://b.test/f')).toBe(other);
    expect((await listFeeds(db, 1)).map((f) => f.url)).toEqual([
      'https://b.test/f',
    ]);
    expect((await listFeeds(db, 2)).map((f) => f.url)).toEqual([
      'https://b.test/f',
    ]);
    expect((await repo.allSources()).map((s) => s.id)).toEqual([other]);
  });
});

describe('sourceActivity', () => {
  it('counts the last month’s distinct stories and the followers', async () => {
    const repo = new Repository(db);
    const { source_id } = (await addFeed(db, 1, 'https://a.test/f'))!;
    await addFeed(db, 2, 'https://a.test/f');
    const recent = new Date(Date.now() - 86_400_000).toISOString();
    await repo.writeEdition(source_id, '2026-10-01', [
      story({ url: 'https://x/1', published_at: recent }),
      story({ url: 'https://x/2', published_at: '2020-01-01T00:00:00Z' }),
    ]);
    await repo.writeEdition(source_id, '2026-10-02', [
      story({ url: 'https://x/1', published_at: recent }),
    ]);
    expect(await repo.sourceActivity(source_id)).toEqual({
      storiesLastMonth: 1,
      subscribers: 2,
      monthsSinceLastStory: 0,
    });
  });

  it('treats a source with no stories as quiet for a year', async () => {
    const repo = new Repository(db);
    const { source_id } = (await addFeed(db, 1, 'https://a.test/f'))!;
    expect((await repo.sourceActivity(source_id)).monthsSinceLastStory).toBe(
      12,
    );
  });
});

describe('saved searches', () => {
  it('keep a search once per feed, newest first, for their owner only', async () => {
    const repo = new Repository(db);
    const feed = (await addFeed(db, 1, 'https://a.test/f'))!;
    const a = await repo.addSearch(1, 'rust', null);
    const b = await repo.addSearch(1, 'rust', feed.id);
    expect(a.created && b.created).toBe(true);
    expect(await repo.addSearch(1, 'rust', null)).toEqual({
      search: a.search,
      created: false,
    });
    expect((await repo.listSearches(1)).map((s) => s.id)).toEqual([
      b.search.id,
      a.search.id,
    ]);
    expect(await repo.listSearches(2)).toEqual([]);
    expect(await repo.getSearch(2, a.search.id)).toBeUndefined();
    expect(await repo.removeSearch(2, a.search.id)).toBe(false);
    expect(await repo.removeSearch(1, a.search.id)).toBe(true);
    expect(await repo.removeSearch(1, a.search.id)).toBe(false);
  });
});

describe('allSources', () => {
  it('leaves out a source nobody follows any more', async () => {
    const feed = (await addFeed(db, 1, 'https://a.test/f'))!;
    await removeFeed(db, 1, feed.id);
    expect(await new Repository(db).allSources()).toEqual([]);
  });
});

describe('writeEdition, sourceArticles and listEditions', () => {
  it('stores a source’s stories once and shows them to every follower', async () => {
    const repo = new Repository(db);
    const { source_id } = (await addFeed(db, 1, 'https://a.test/f'))!;
    await addFeed(db, 2, 'https://a.test/f');
    await repo.writeEdition(source_id, '2026-10-20', [
      {
        url: 'https://x/1',
        title: 'One',
        source: '',
        favicon: '',
        summary: '',
        image: '',
        published_at: '',
        points: 0,
      },
    ]);
    expect(await repo.sourceArticles(source_id, '2026-10-20')).toHaveLength(1);
    expect(await repo.listEditions(1)).toEqual(['2026-10-20']);
    expect(await repo.listEditions(2)).toEqual(['2026-10-20']);
    expect(await repo.editionsForSource(source_id)).toEqual(['2026-10-20']);
  });

  it('keeps where each story is discussed', async () => {
    const repo = new Repository(db);
    const { source_id } = (await addFeed(db, 1, 'https://a.test/f'))!;
    await repo.writeEdition(source_id, '2026-10-20', [
      story({ url: 'https://x/1', comments_url: 'https://hn/item?id=1' }),
      story({ url: 'https://x/2' }),
    ]);
    const rows = await repo.sourceArticles(source_id, '2026-10-20');
    expect(rows.map((r) => r.comments_url).sort()).toEqual([
      'https://hn/item?id=1',
      null,
    ]);
  });
});

/** A scraped story with only what a case cares about filled in. */
const story = (over: Partial<ScrapedItem>): ScrapedItem => ({
  url: 'https://x/1',
  title: 'Untitled',
  source: '',
  favicon: '',
  summary: '',
  image: '',
  published_at: '',
  points: 0,
  ...over,
});

describe('ftsQuery', () => {
  it('quotes every word so FTS5 syntax is matched as text', () => {
    expect(ftsQuery('  rust  "async" OR -x ')).toBe(
      '"rust" """async""" "OR" "-x"',
    );
    expect(ftsQuery('   ')).toBe('');
  });
});

describe('searchArticles and getArticle', () => {
  it('list one feed, newest copy of each story only', async () => {
    const repo = new Repository(db);
    const a = (await addFeed(db, 1, 'https://a.test/f'))!;
    const b = (await addFeed(db, 1, 'https://b.test/f'))!;
    await repo.writeEdition(a.source_id, '2026-10-01', [
      story({ url: 'https://x/1' }),
    ]);
    await repo.writeEdition(a.source_id, '2026-10-02', [
      story({ url: 'https://x/1' }),
      story({ url: 'https://x/2' }),
    ]);
    await repo.writeEdition(b.source_id, '2026-10-02', [
      story({ url: 'https://y/1' }),
    ]);
    const listed = await repo.searchArticles(1, { feed: a.id, limit: 10 });
    expect(listed.map((x) => [x.url, x.edition])).toEqual([
      ['https://x/2', '2026-10-02'],
      ['https://x/1', '2026-10-02'],
    ]);
  });

  it('list nothing for a feed someone else follows', async () => {
    const repo = new Repository(db);
    const a = (await addFeed(db, 1, 'https://a.test/f'))!;
    await repo.writeEdition(a.source_id, '2026-10-01', [story({})]);
    expect(await repo.searchArticles(2, { feed: a.id, limit: 10 })).toEqual([]);
  });

  it('search the title, summary and body text of every edition', async () => {
    const repo = new Repository(db);
    const { source_id } = (await addFeed(db, 1, 'https://a.test/f'))!;
    await repo.writeEdition(source_id, '2026-10-01', [
      story({ url: 'https://x/1', title: 'Rust in the kernel' }),
    ]);
    await repo.writeEdition(source_id, '2026-10-02', [
      story({ url: 'https://x/2', summary: 'Why rust compiles slowly' }),
      story({ url: 'https://x/3', body_text: 'A long piece on Rust.' }),
      story({ url: 'https://x/4', title: 'Go generics' }),
    ]);
    const found = await repo.searchArticles(1, { q: 'rust', limit: 10 });
    expect(found.map((a) => a.url)).toEqual([
      'https://x/3',
      'https://x/2',
      'https://x/1',
    ]);
    expect(found[0]).not.toHaveProperty('body_text');
  });

  it('need every word, and list everything without any', async () => {
    const repo = new Repository(db);
    const { source_id } = (await addFeed(db, 1, 'https://a.test/f'))!;
    await repo.writeEdition(source_id, '2026-10-01', [
      story({ url: 'https://x/1', title: 'Rust kernel' }),
      story({ url: 'https://x/2', title: 'Rust compiler' }),
    ]);
    expect(
      (await repo.searchArticles(1, { q: 'rust kernel', limit: 10 })).map(
        (a) => a.url,
      ),
    ).toEqual(['https://x/1']);
    expect(await repo.searchArticles(1, { limit: 10 })).toHaveLength(2);
  });

  it('list oldest first when asked, paging forwards', async () => {
    const repo = new Repository(db);
    const { source_id } = (await addFeed(db, 1, 'https://a.test/f'))!;
    await repo.writeEdition(
      source_id,
      '2026-10-01',
      [1, 2, 3].map((n) => story({ url: `https://x/${n}` })),
    );
    const first = await repo.searchArticles(1, { limit: 2, oldest: true });
    expect(first.map((a) => a.url)).toEqual([
      'https://x/1',
      'https://x/2',
      'https://x/3',
    ]);
    const rest = await repo.searchArticles(1, {
      limit: 2,
      oldest: true,
      before: first[1]!.id,
    });
    expect(rest.map((a) => a.url)).toEqual(['https://x/3']);
  });

  it('page by id, asking for one more than the limit', async () => {
    const repo = new Repository(db);
    const { source_id } = (await addFeed(db, 1, 'https://a.test/f'))!;
    await repo.writeEdition(
      source_id,
      '2026-10-01',
      [1, 2, 3].map((n) => story({ url: `https://x/${n}` })),
    );
    const first = await repo.searchArticles(1, { limit: 2 });
    expect(first).toHaveLength(3);
    const rest = await repo.searchArticles(1, {
      limit: 2,
      before: first[1]!.id,
    });
    expect(rest.map((a) => a.id)).toEqual([first[2]!.id]);
  });

  it('show only articles from sources the person follows', async () => {
    const repo = new Repository(db);
    const { source_id } = (await addFeed(db, 1, 'https://a.test/f'))!;
    await repo.writeEdition(source_id, '2026-10-01', [
      story({ title: 'Rust', body_text: 'The text.' }),
    ]);
    const [article] = await repo.searchArticles(1, { q: 'rust', limit: 10 });
    expect(await repo.searchArticles(2, { q: 'rust', limit: 10 })).toEqual([]);
    expect((await repo.getArticle(1, article!.id))?.body_text).toBe(
      'The text.',
    );
    expect(await repo.getArticle(2, article!.id)).toBeUndefined();
  });

  it('keep ids and fetched text when an edition is written again', async () => {
    const repo = new Repository(db);
    const { source_id } = (await addFeed(db, 1, 'https://a.test/f'))!;
    await repo.writeEdition(source_id, '2026-10-01', [
      story({ url: 'https://x/1', title: 'Rust', body_text: 'The text.' }),
      story({ url: 'https://x/2', title: 'Gone' }),
    ]);
    const [before] = await repo.searchArticles(1, { q: 'rust', limit: 10 });
    await repo.writeEdition(source_id, '2026-10-01', [
      story({ url: 'https://x/1', title: 'Rust again' }),
    ]);
    const after = await repo.getArticle(1, before!.id);
    expect(after).toMatchObject({
      title: 'Rust again',
      body_text: 'The text.',
    });
    expect(await repo.searchArticles(1, { limit: 10 })).toHaveLength(1);
    expect(await repo.searchArticles(1, { q: 'gone', limit: 10 })).toEqual([]);
  });

  it('keep the summary a story first had once a fetch changes it', async () => {
    const repo = new Repository(db);
    const { source_id } = (await addFeed(db, 1, 'https://a.test/f'))!;
    const write = (summary: string) =>
      repo.writeEdition(source_id, '2026-10-01', [story({ summary })]);
    await write('First');
    await write('First');
    const [same] = await repo.searchArticles(1, { limit: 1 });
    expect((await repo.getArticle(1, same!.id))?.original_summary).toBeNull();
    await write('Second');
    await write('Third');
    expect(await repo.getArticle(1, same!.id)).toMatchObject({
      summary: 'Third',
      original_summary: 'First',
    });
  });

  it('keep the row of a story whose address changed under the same id', async () => {
    const repo = new Repository(db);
    const { source_id } = (await addFeed(db, 1, 'https://a.test/f'))!;
    await repo.writeEdition(source_id, '2026-10-01', [
      story({ url: 'https://x/old', guid: 'g1' }),
    ]);
    const [before] = await repo.searchArticles(1, { limit: 1 });
    await repo.writeEdition(source_id, '2026-10-01', [
      story({ url: 'https://x/new', guid: 'g1' }),
    ]);
    const after = await repo.searchArticles(1, { limit: 10 });
    expect(after.map((a) => [a.id, a.url])).toEqual([
      [before!.id, 'https://x/new'],
    ]);
  });

  it('find similar stories by title words, never the same address', async () => {
    const repo = new Repository(db);
    const { source_id } = (await addFeed(db, 1, 'https://a.test/f'))!;
    await repo.writeEdition(source_id, '2026-10-01', [
      story({ url: 'https://x/1', title: 'Rust compiler gets faster builds' }),
      story({ url: 'https://x/2', title: 'Faster Rust compiler builds land' }),
      story({ url: 'https://x/3', title: 'Gardening in winter' }),
    ]);
    await repo.writeEdition(source_id, '2026-10-02', [
      story({ url: 'https://x/1', title: 'Rust compiler gets faster builds' }),
    ]);
    const [article] = await repo.searchArticles(1, { q: 'gets', limit: 1 });
    const similar = await repo.similarArticles(1, article!, 10);
    expect(similar.map((a) => a.url)).toEqual(['https://x/2']);
    expect(await repo.similarArticles(2, article!, 10)).toEqual([]);
    expect(
      await repo.similarArticles(1, { ...article!, title: 'a an' }, 10),
    ).toEqual([]);
  });

  it('forget the old text when an edition is written again', async () => {
    const repo = new Repository(db);
    const { source_id } = (await addFeed(db, 1, 'https://a.test/f'))!;
    await repo.writeEdition(source_id, '2026-10-01', [
      story({ title: 'Rust' }),
    ]);
    await repo.writeEdition(source_id, '2026-10-01', [story({ title: 'Go' })]);
    expect(await repo.searchArticles(1, { q: 'rust', limit: 10 })).toEqual([]);
    expect(await repo.searchArticles(1, { q: 'go', limit: 10 })).toHaveLength(
      1,
    );
  });
});

/** Person 1 follows a source with one story on 2026-10-20; its article id. */
async function oneStory(): Promise<{ source_id: number; id: number }> {
  const repo = new Repository(db);
  const { source_id } = (await addFeed(db, 1, 'https://a.test/f'))!;
  await repo.writeEdition(source_id, '2026-10-20', [
    story({ url: 'https://x/1' }),
  ]);
  const [a] = await repo.sourceArticles(source_id, '2026-10-20');
  return { source_id, id: a!.id };
}

describe('classifiers', () => {
  it('adds a classifier and lists it for its owner only', async () => {
    const repo = new Repository(db);
    const { created } = await repo.addClassifier(1, {
      kind: 'source',
      value: 'a.test',
      score: 1,
    });
    expect(created).toBe(true);
    expect(await repo.listClassifiers(1)).toMatchObject([
      { kind: 'source', value: 'a.test', score: 1 },
    ]);
    expect(await repo.listClassifiers(2)).toEqual([]);
  });

  it('replaces the score of a classifier for the same kind and value', async () => {
    const repo = new Repository(db);
    const input = { kind: 'title', value: 'rust', score: 1 };
    const first = await repo.addClassifier(1, input);
    const again = await repo.addClassifier(1, { ...input, score: -1 });
    expect(again).toMatchObject({
      created: false,
      classifier: { id: first.classifier.id, score: -1 },
    });
  });

  it('removes only the owner’s classifier', async () => {
    const repo = new Repository(db);
    const { classifier } = await repo.addClassifier(1, {
      kind: 'tag',
      value: 'x',
      score: 1,
    });
    expect(await repo.removeClassifier(2, classifier.id)).toBe(false);
    expect(await repo.removeClassifier(1, classifier.id)).toBe(true);
    expect(await repo.listClassifiers(1)).toEqual([]);
  });
});

describe('saves', () => {
  it('saves a story with tags and replaces them on a second save', async () => {
    const repo = new Repository(db);
    const { id } = await oneStory();
    expect(await repo.saveArticle(1, id, ['a'])).toMatchObject({
      created: true,
      story: { tags: ['a'] },
    });
    expect(await repo.saveArticle(1, id, ['b'])).toMatchObject({
      created: false,
      story: { tags: ['b'] },
    });
  });

  it('refuses to save an article that does not exist', async () => {
    expect(await new Repository(db).saveArticle(1, 999, [])).toBeUndefined();
  });

  it('lists only the saves carrying a tag when asked', async () => {
    const repo = new Repository(db);
    const { id } = await oneStory();
    await repo.saveArticle(1, id, ['keep']);
    expect(await repo.listSaves(1, 'keep')).toHaveLength(1);
    expect(await repo.listSaves(1, 'other')).toEqual([]);
    expect(await repo.listSaves(2)).toEqual([]);
  });

  it('unsaves a story once', async () => {
    const repo = new Repository(db);
    const { id } = await oneStory();
    await repo.saveArticle(1, id, []);
    expect(await repo.unsaveArticle(1, id)).toBe(true);
    expect(await repo.unsaveArticle(1, id)).toBe(false);
  });

  it('keeps a saved story when its edition is written again', async () => {
    const repo = new Repository(db);
    const { source_id, id } = await oneStory();
    await repo.saveArticle(1, id, []);
    await repo.writeEdition(source_id, '2026-10-20', [
      story({ url: 'https://x/2' }),
    ]);
    expect(
      (await repo.sourceArticles(source_id, '2026-10-20')).map((a) => a.id),
    ).toContain(id);
    expect(await repo.listSaves(1)).toHaveLength(1);
  });

  it('drops an unsaved story when its edition is written again', async () => {
    const repo = new Repository(db);
    const { source_id, id } = await oneStory();
    await repo.writeEdition(source_id, '2026-10-20', [
      story({ url: 'https://x/2' }),
    ]);
    expect(
      (await repo.sourceArticles(source_id, '2026-10-20')).map((a) => a.id),
    ).not.toContain(id);
  });
});

describe('reads', () => {
  it('keeps a read story when its edition is written again', async () => {
    const repo = new Repository(db);
    const { source_id, id } = await oneStory();
    await repo.markRead(1, id);
    await repo.writeEdition(source_id, '2026-10-20', [
      story({ url: 'https://x/1' }),
    ]);
    expect([...(await repo.readState(1)).ids]).toEqual([id]);
  });

  it('notes a read once and reports its id and address', async () => {
    const repo = new Repository(db);
    const { id } = await oneStory();
    expect(await repo.markRead(1, id)).toBe(true);
    expect(await repo.markRead(1, id)).toBe(false);
    const state = await repo.readState(1);
    expect([...state.ids]).toEqual([id]);
    expect([...state.urls]).toEqual(['https://x/1']);
    expect((await repo.readState(2)).ids.size).toBe(0);
  });

  it('refuses to note an article that does not exist', async () => {
    expect(await new Repository(db).markRead(1, 999)).toBeUndefined();
  });

  it('marks many stories read, leaving out ones that are not articles', async () => {
    const repo = new Repository(db);
    const { id } = await oneStory();
    expect(await repo.markManyRead(1, [id, id, 999])).toEqual([id]);
    expect([...(await repo.readState(1)).ids]).toEqual([id]);
  });

  it('marks a read story unread again, only for that person', async () => {
    const repo = new Repository(db);
    const { id } = await oneStory();
    await repo.markRead(1, id);
    expect(await repo.markUnread(2, id)).toBe(false);
    expect(await repo.markUnread(1, id)).toBe(true);
    expect(await repo.markUnread(1, id)).toBe(false);
    expect((await repo.readState(1)).ids.size).toBe(0);
  });
});

describe('feedStatistics', () => {
  const story = (n: number) => ({
    url: `https://x/${n}`,
    title: 'T',
    source: '',
    favicon: '',
    summary: '',
    image: '',
    published_at: '',
    points: 0,
  });

  it('reports fetch health and stories per day, newest first', async () => {
    const repo = new Repository(db);
    const feed = (await addFeed(db, 1, 'https://a.test/f'))!;
    await repo.writeEdition(feed.source_id, '2026-10-19', [story(1)]);
    await repo.writeEdition(feed.source_id, '2026-10-20', [story(2), story(3)]);
    await repo.recordFetch(feed.source_id, 'boom');
    expect(await repo.feedStatistics(1, feed.id)).toMatchObject({
      last_fetched_at: null,
      last_error: 'boom',
      fail_count: 1,
      stories_per_day: [
        { date: '2026-10-20', count: 2 },
        { date: '2026-10-19', count: 1 },
      ],
    });
    expect(
      (await repo.feedStatistics(1, feed.id, 1))?.stories_per_day,
    ).toHaveLength(1);
  });

  it('is undefined for a feed that is not theirs', async () => {
    const feed = (await addFeed(db, 1, 'https://a.test/f'))!;
    expect(await new Repository(db).feedStatistics(2, feed.id)).toBeUndefined();
  });

  it('counts stories by month, weekday and hour, and the readers', async () => {
    const repo = new Repository(db);
    const feed = (await addFeed(db, 1, 'https://a.test/f'))!;
    await addFeed(db, 2, 'https://a.test/f');
    await repo.updateFeed(
      2,
      (await repo.getFeedByUrl(2, 'https://a.test/f'))!.id,
      { muted: true },
    );
    const at = (n: number, published_at: string) => ({
      ...story(n),
      published_at,
    });
    await repo.writeEdition(feed.source_id, '2026-09-14', [
      at(1, '2026-09-14T08:30:00Z'),
    ]);
    await repo.writeEdition(feed.source_id, '2026-10-19', [
      at(2, '2026-10-19T08:00:00Z'),
      at(3, '2026-10-19T21:00:00Z'),
    ]);
    const stats = await repo.feedStatistics(1, feed.id);
    expect(stats).toMatchObject({
      story_count: 3,
      subscribers: 2,
      active_subscribers: 1,
      stories_per_month: [
        { month: '2026-10', count: 2 },
        { month: '2026-09', count: 1 },
      ],
      average_stories_per_month: 1.5,
      stories_per_weekday: { '1': 3 },
      stories_per_hour: { '08': 2, '21': 1 },
    });
  });

  it('remembers the latest fetches, newest first, and forgets the oldest', async () => {
    const repo = new Repository(db);
    const feed = (await addFeed(db, 1, 'https://a.test/f'))!;
    for (let n = 0; n < FETCH_HISTORY_LIMIT + 3; n += 1) {
      await repo.recordFetch(feed.source_id, n % 2 ? `bad ${n}` : undefined);
    }
    const history = (await repo.feedStatistics(1, feed.id))!.fetch_history;
    expect(history).toHaveLength(FETCH_HISTORY_LIMIT);
    expect(history[0]).toMatchObject({
      ok: false,
      message: `bad ${FETCH_HISTORY_LIMIT + 2}`,
    });
    expect(history[1]).toMatchObject({ ok: true, message: null });
  });

  it('reports the update interval a feed asks for', async () => {
    const feed = (await addFeed(db, 1, 'https://a.test/f'))!;
    expect(
      (await new Repository(db).feedStatistics(1, feed.id))!.update_minutes,
    ).toBeNull();
  });
});

describe('feedStatistics fetch timing and archive', () => {
  it('reports when a failing feed is next fetched and how many stories keep their text', async () => {
    const repo = new Repository(db);
    const feed = (await addFeed(db, 1, 'https://a.test/f'))!;
    expect((await repo.feedStatistics(1, feed.id))!.next_fetch_at).toBeNull();
    await repo.recordFetch(feed.source_id, {
      error: 'boom',
      durationMs: 120,
    });
    const stats = (await repo.feedStatistics(1, feed.id))!;
    expect(stats.next_fetch_at).not.toBeNull();
    expect(stats.fetch_history[0]).toMatchObject({
      ok: false,
      duration_ms: 120,
    });
    expect(stats.archive_count).toBe(0);
    await repo.writeEdition(feed.source_id, '2026-10-20', [
      {
        url: 'https://x/1',
        title: 'T',
        source: '',
        favicon: '',
        summary: '',
        image: '',
        published_at: '',
        points: 0,
        body_text: 'Full text.',
      } as never,
    ]);
    expect((await repo.feedStatistics(1, feed.id))!.archive_count).toBe(1);
  });
});

describe('clearFailures', () => {
  it('forgets the failures but keeps the history', async () => {
    const repo = new Repository(db);
    const feed = (await addFeed(db, 1, 'https://a.test/f'))!;
    await repo.recordFetch(feed.source_id, 'boom');
    await repo.clearFailures(feed.source_id);
    expect(await repo.feedStatistics(1, feed.id)).toMatchObject({
      fail_count: 0,
      last_error: null,
      fetch_history: [{ ok: false, message: 'boom' }],
    });
  });
});

describe('updateFeed with a new address', () => {
  it('follows the new address in the feed’s place, keeping its settings', async () => {
    const repo = new Repository(db);
    const feed = (await addFeed(db, 1, 'https://old.test/f'))!;
    await repo.updateFeed(1, feed.id, { title: 'Mine' });
    const moved = await repo.updateFeed(1, feed.id, {
      url: 'https://new.test/f',
    });
    expect(moved).toMatchObject({
      id: feed.id,
      url: 'https://new.test/f',
      title: 'Mine',
    });
    expect(moved!.source_id).not.toBe(feed.source_id);
    expect(await repo.getFeedByUrl(1, 'https://old.test/f')).toBeUndefined();
  });
});

describe('storyCounts', () => {
  const story = (n: number) => ({
    url: `https://x/${n}`,
    title: 'T',
    source: '',
    favicon: '',
    summary: '',
    image: '',
    published_at: '',
    points: 0,
  });

  it('counts each feed’s stories once, for its owner only', async () => {
    const repo = new Repository(db);
    const feed = (await addFeed(db, 1, 'https://a.test/f'))!;
    await addFeed(db, 1, 'https://b.test/f');
    await repo.writeEdition(feed.source_id, '2026-10-19', [story(1)]);
    await repo.writeEdition(feed.source_id, '2026-10-20', [story(1), story(2)]);
    expect(await repo.storyCounts(1)).toEqual(new Map([[feed.id, 2]]));
    expect(await repo.storyCounts(2)).toEqual(new Map());
  });
});

describe('clusters and issues', () => {
  const quake = (n: number): ScrapedItem => ({
    url: `https://s${n}.test/q`,
    title: 'Quake',
    source: `S${n}`,
    favicon: '',
    summary: '',
    image: '',
    published_at: '',
    points: 0,
  });

  it('lists every article of an edition, from every source', async () => {
    const repo = new Repository(db);
    await repo.writeEdition(1, '2026-11-01', [quake(1)]);
    await repo.writeEdition(2, '2026-11-01', [quake(2)]);
    await repo.writeEdition(2, '2026-10-31', [quake(3)]);
    expect(
      (await repo.editionArticles('2026-11-01')).map((a) => a.source_id),
    ).toEqual([1, 2]);
  });

  it('replaces an edition’s clusters', async () => {
    const repo = new Repository(db);
    await repo.writeEdition(1, '2026-11-01', [quake(1)]);
    await repo.writeEdition(2, '2026-11-01', [quake(2)]);
    const ids = (await repo.editionArticles('2026-11-01')).map((a) => a.id);
    await repo.writeClusters('2026-11-01', [ids]);
    const first = await repo.articlesByIds(ids);
    expect(new Set(first.map((a) => a.cluster_id)).size).toBe(1);
    await repo.writeClusters('2026-11-01', []);
    expect(
      (await repo.articlesByIds(ids)).every((a) => a.cluster_id === null),
    ).toBe(true);
  });

  it('reads articles by more ids than one query can bind', async () => {
    const repo = new Repository(db);
    await repo.writeEdition(
      1,
      '2026-11-01',
      Array.from({ length: 120 }, (_, n) => ({
        ...quake(n),
        url: `https://x/${n}`,
      })),
    );
    const ids = (await repo.editionArticles('2026-11-01')).map((a) => a.id);
    expect(await repo.articlesByIds([...ids, ...ids])).toHaveLength(120);
  });

  it('lists the people who follow a feed', async () => {
    const a = await upsertUser(db, { sub: 'a', email: 'a@b.c' });
    await upsertUser(db, { sub: 'b', email: 'b@b.c' });
    await addFeed(db, a.id, 'https://x.test/rss');
    expect(await new Repository(db).readerIds()).toEqual([a.id]);
  });

  it('stores and replaces a person’s issue for a day', async () => {
    const repo = new Repository(db);
    await repo.saveIssue(1, '2026-11-01', '{"groups":[]}', 'One');
    await repo.saveIssue(1, '2026-11-01', '{"groups":[]}', null);
    expect(await repo.getIssue(1, '2026-11-01')).toMatchObject({
      layout: '{"groups":[]}',
      briefing: null,
    });
    expect(await repo.getIssue(2, '2026-11-01')).toBeUndefined();
  });
});

describe('anyWordQuery', () => {
  it('matches any word that is not too short or too common', () => {
    expect(anyWordQuery('What is the Rust borrow checker, and Rust?')).toBe(
      '"rust" OR "borrow" OR "checker"',
    );
  });

  it('is empty when no word is left', () => {
    expect(anyWordQuery('is it the?')).toBe('');
  });
});

describe('retrievePassages', () => {
  /** Person 1 follows a source with a story about rust; person 2 follows another. */
  async function setup(): Promise<{ mine: number; other: number }> {
    const repo = new Repository(db);
    const a = (await addFeed(db, 1, 'https://a.test/f'))!;
    const b = (await addFeed(db, 2, 'https://b.test/f'))!;
    await repo.writeEdition(a.source_id, '2026-10-20', [
      story({ url: 'https://x/1', title: 'Rust', body_text: 'rust borrow' }),
    ]);
    await repo.writeEdition(b.source_id, '2026-10-20', [
      story({
        url: 'https://x/2',
        title: 'Other',
        body_text: 'rust collector',
      }),
    ]);
    const [mine] = await repo.sourceArticles(a.source_id, '2026-10-20');
    const [other] = await repo.sourceArticles(b.source_id, '2026-10-20');
    return { mine: mine!.id, other: other!.id };
  }

  it('finds stories from followed sources by any word', async () => {
    const { mine } = await setup();
    const found = await new Repository(db).retrievePassages(1, 'borrow tips');
    expect(found).toEqual([
      expect.objectContaining({ id: mine, title: 'Rust', text: 'rust borrow' }),
    ]);
  });

  it('leaves out stories the person neither follows, saved nor read', async () => {
    await setup();
    const found = await new Repository(db).retrievePassages(1, 'collector');
    expect(found).toEqual([]);
  });

  it('includes a story the person read from a source they do not follow', async () => {
    const { other } = await setup();
    await db.run(
      sql`INSERT INTO reads (user_id, article_id) VALUES (1, ${other})`,
    );
    const found = await new Repository(db).retrievePassages(1, 'collector');
    expect(found.map((p) => p.id)).toEqual([other]);
  });

  it('includes a story the person saved', async () => {
    const { other } = await setup();
    await db.run(
      sql`INSERT INTO saves (user_id, article_id) VALUES (1, ${other})`,
    );
    const found = await new Repository(db).retrievePassages(1, 'collector');
    expect(found.map((p) => p.id)).toEqual([other]);
  });

  it('finds nothing for a question of only common words', async () => {
    await setup();
    expect(await new Repository(db).retrievePassages(1, 'what is it')).toEqual(
      [],
    );
  });
});

describe('conversations and messages', () => {
  it('keeps turns in order with their citations', async () => {
    const repo = new Repository(db);
    const c = await repo.addConversation(1);
    await repo.addMessage(c.id, 'user', 'Q');
    await repo.addMessage(c.id, 'assistant', 'A', [4, 5]);
    expect(await repo.listMessages(c.id)).toEqual([
      expect.objectContaining({ role: 'user', content: 'Q', citations: [] }),
      expect.objectContaining({
        role: 'assistant',
        content: 'A',
        citations: [4, 5],
      }),
    ]);
  });

  it('shows a conversation only to its owner', async () => {
    const repo = new Repository(db);
    const c = await repo.addConversation(1);
    expect(await repo.getConversation(1, c.id)).toMatchObject({ id: c.id });
    expect(await repo.getConversation(2, c.id)).toBeUndefined();
  });
});

describe('articleTitles', () => {
  it('maps ids to titles, leaving out unknown ids', async () => {
    const repo = new Repository(db);
    const { source_id } = (await addFeed(db, 1, 'https://a.test/f'))!;
    await repo.writeEdition(source_id, '2026-10-20', [story({ title: 'One' })]);
    const [a] = await repo.sourceArticles(source_id, '2026-10-20');
    expect(await repo.articleTitles([a!.id, 999])).toEqual(
      new Map([[a!.id, 'One']]),
    );
    expect(await repo.articleTitles([])).toEqual(new Map());
  });
});

describe('suggestSources', () => {
  it('suggests what people sharing a source also follow, most shared first', async () => {
    await addFeed(db, 1, 'https://shared.test/f');
    for (const uid of [2, 3]) {
      await addFeed(db, uid, 'https://shared.test/f');
      await addFeed(db, uid, 'https://popular.test/f');
    }
    await addFeed(db, 3, 'https://niche.test/f');
    await addFeed(db, 4, 'https://stranger.test/f');
    const found = await new Repository(db).suggestSources(1);
    expect(found.map((s) => [s.url, s.followers])).toEqual([
      ['https://popular.test/f', 2],
      ['https://niche.test/f', 1],
    ]);
  });

  it('leaves out sources the person follows already', async () => {
    await addFeed(db, 1, 'https://shared.test/f');
    await addFeed(db, 1, 'https://popular.test/f');
    await addFeed(db, 2, 'https://shared.test/f');
    await addFeed(db, 2, 'https://popular.test/f');
    expect(await new Repository(db).suggestSources(1)).toEqual([]);
  });

  it('suggests nothing to someone who follows nothing', async () => {
    await addFeed(db, 2, 'https://popular.test/f');
    expect(await new Repository(db).suggestSources(1)).toEqual([]);
  });
});

describe('custom editions', () => {
  it('adds, changes and lists a person’s editions with their rules', async () => {
    const repo = new Repository(db);
    const added = await repo.addCustomEdition(1, {
      name: 'Weekend',
      section_ids: [3],
      query: 'rust',
    });
    expect(added).toMatchObject({ section_ids: [3], query: 'rust', tag: null });
    await repo.updateCustomEdition(1, added.id, { section_ids: [], tag: 't' });
    expect(await repo.listCustomEditions(1)).toMatchObject([
      { name: 'Weekend', section_ids: [], query: 'rust', tag: 't' },
    ]);
  });

  it('never reads, changes or removes another person’s edition', async () => {
    const repo = new Repository(db);
    const { id } = await repo.addCustomEdition(1, { name: 'Mine' });
    expect(await repo.getCustomEdition(2, id)).toBeUndefined();
    expect(
      await repo.updateCustomEdition(2, id, { name: 'Taken' }),
    ).toBeUndefined();
    expect(await repo.removeCustomEdition(2, id)).toBe(false);
    expect((await repo.getCustomEdition(1, id))?.name).toBe('Mine');
  });

  it('removes an edition with the issues it printed', async () => {
    const repo = new Repository(db);
    const { id } = await repo.addCustomEdition(1, { name: 'Gone' });
    await repo.saveEditionIssue(id, '2026-11-01', '{"groups":[]}', null);
    expect(await repo.removeCustomEdition(1, id)).toBe(true);
    expect(await repo.getEditionIssue(id, '2026-11-01')).toBeUndefined();
  });

  it('stores and replaces an edition’s issue for a day', async () => {
    const repo = new Repository(db);
    await repo.saveEditionIssue(4, '2026-11-01', '{"groups":[]}', 'One');
    await repo.saveEditionIssue(4, '2026-11-01', '{"groups":[]}', 'Two');
    expect(await repo.getEditionIssue(4, '2026-11-01')).toMatchObject({
      briefing: 'Two',
    });
  });

  it('lists every person’s editions for the daily run', async () => {
    const repo = new Repository(db);
    await repo.addCustomEdition(1, { name: 'A' });
    await repo.addCustomEdition(2, { name: 'B' });
    expect((await repo.allCustomEditions()).map((e) => e.name)).toEqual([
      'A',
      'B',
    ]);
  });
});

describe('trendingArticles', () => {
  const story = (n: number) => ({
    url: `https://t/${n}`,
    title: `T${n}`,
    source: '',
    favicon: '',
    summary: '',
    image: '',
    published_at: '',
    points: 0,
  });

  /** Two readers following one feed with three stories; returns the ids. */
  async function seed(): Promise<{ a: number; b: number; ids: number[] }> {
    const repo = new Repository(db);
    const a = (await upsertUser(db, { sub: 'a', email: 'a@b.c' })).id;
    const b = (await upsertUser(db, { sub: 'b', email: 'b@b.c' })).id;
    const feed = await addFeed(db, a, 'https://t/rss');
    await addFeed(db, b, 'https://t/rss');
    await repo.writeEdition(
      feed!.source_id,
      '2026-11-01',
      [1, 2, 3].map(story),
    );
    const ids = (await repo.sourceArticles(feed!.source_id, '2026-11-01'))
      .map((x) => x.id)
      .toSorted((x, y) => x - y);
    return { a, b, ids };
  }

  it('ranks by how many people read each story, then newest', async () => {
    const repo = new Repository(db);
    const { a, b, ids } = await seed();
    await repo.markRead(a, ids[0]!);
    await repo.markRead(b, ids[0]!);
    await repo.markRead(a, ids[1]!);
    await repo.markRead(b, ids[2]!);
    const rows = await repo.trendingArticles(a, {
      order: 'reads',
      since: '2000-01-01 00:00:00',
      limit: 10,
    });
    expect(rows.map((r) => [r.article.id, r.count])).toEqual([
      [ids[0], 2],
      [ids[2], 1],
      [ids[1], 1],
    ]);
  });

  it('pages after a count and id', async () => {
    const repo = new Repository(db);
    const { a, b, ids } = await seed();
    await repo.markRead(a, ids[0]!);
    await repo.markRead(b, ids[0]!);
    await repo.markRead(a, ids[1]!);
    await repo.markRead(b, ids[2]!);
    const rows = await repo.trendingArticles(a, {
      order: 'reads',
      since: '2000-01-01 00:00:00',
      after: { count: 1, id: ids[2]! },
      limit: 10,
    });
    expect(rows.map((r) => r.article.id)).toEqual([ids[1]]);
  });

  it('ranks saves, and counts nothing before the window', async () => {
    const repo = new Repository(db);
    const { a, ids } = await seed();
    await repo.saveArticle(a, ids[1]!, []);
    expect(
      await repo.trendingArticles(a, {
        order: 'saves',
        since: '2000-01-01 00:00:00',
        limit: 10,
      }),
    ).toMatchObject([{ article: { id: ids[1] }, count: 1 }]);
    expect(
      await repo.trendingArticles(a, {
        order: 'saves',
        since: '2999-01-01 00:00:00',
        limit: 10,
      }),
    ).toEqual([]);
  });

  it('leaves out stories from sources the person does not follow', async () => {
    const repo = new Repository(db);
    const { a, ids } = await seed();
    await repo.markRead(a, ids[0]!);
    const c = (await upsertUser(db, { sub: 'c', email: 'c@b.c' })).id;
    expect(
      await repo.trendingArticles(c, {
        order: 'reads',
        since: '2000-01-01 00:00:00',
        limit: 10,
      }),
    ).toEqual([]);
  });
});

describe('removeSection and custom editions', () => {
  it('drops the removed section from the editions that printed it', async () => {
    const repo = new Repository(db);
    const keep = await repo.addSection(1, 'Keep');
    const gone = await repo.addSection(1, 'Gone');
    const { id } = await repo.addCustomEdition(1, {
      name: 'Weekend',
      section_ids: [keep.id, gone.id],
    });
    await repo.removeSection(1, gone.id);
    expect((await repo.getCustomEdition(1, id))?.section_ids).toEqual([
      keep.id,
    ]);
  });
});

describe('listEditions', () => {
  it('leaves out the days only a muted feed has', async () => {
    const repo = new Repository(db);
    const loud = (await addFeed(db, 1, 'https://a.test/loud'))!;
    const quiet = (await addFeed(db, 1, 'https://a.test/quiet'))!;
    const item = {
      url: 'https://x/1',
      title: 'One',
      source: '',
      favicon: '',
      summary: '',
      image: '',
      published_at: '',
      points: 0,
    };
    await repo.writeEdition(loud.source_id, '2026-10-20', [item]);
    await repo.writeEdition(quiet.source_id, '2026-10-21', [item]);
    await repo.updateFeed(1, quiet.id, { muted: true });
    expect(await repo.listEditions(1)).toEqual(['2026-10-20']);
  });
});

describe('feed order and timed mutes', () => {
  it('lists feeds in the order the person gave them', async () => {
    const repo = new Repository(db);
    const a = (await addFeed(db, 1, 'https://a.test/a'))!;
    const b = (await addFeed(db, 1, 'https://a.test/b'))!;
    await repo.updateFeed(1, a.id, { position: 2 });
    await repo.updateFeed(1, b.id, { position: 1 });
    expect((await listFeeds(db, 1)).map((f) => f.id)).toEqual([b.id, a.id]);
  });

  it('counts a feed as muted only until its mute runs out', async () => {
    const repo = new Repository(db);
    const feed = (await addFeed(db, 1, 'https://a.test/f'))!;
    await repo.updateFeed(1, feed.id, {
      muted: true,
      muted_until: '2999-01-01 00:00:00',
    });
    expect((await repo.getFeed(1, feed.id))?.muted).toBe(true);
    await repo.updateFeed(1, feed.id, { muted_until: '2000-01-01 00:00:00' });
    expect((await repo.getFeed(1, feed.id))?.muted).toBe(false);
  });

  it('forgets when a mute was to run out once the feed is unmuted', async () => {
    const repo = new Repository(db);
    const feed = (await addFeed(db, 1, 'https://a.test/f'))!;
    await repo.updateFeed(1, feed.id, {
      muted: true,
      muted_until: '2999-01-01 00:00:00',
    });
    await repo.updateFeed(1, feed.id, { muted: false });
    expect((await repo.getFeed(1, feed.id))?.muted_until).toBeNull();
  });
});

describe('nested sections', () => {
  it('lists each section followed by the sections nested in it', async () => {
    const repo = new Repository(db);
    const b = await repo.addSection(1, 'B', 1);
    const a = await repo.addSection(1, 'A', 0);
    await repo.addSection(1, 'B2', undefined, b.id);
    await repo.addSection(1, 'A1', undefined, a.id);
    expect((await repo.listSections(1)).map((s) => s.name)).toEqual([
      'A',
      'A1',
      'B',
      'B2',
    ]);
  });

  it('puts a new nested section after its siblings only', async () => {
    const repo = new Repository(db);
    const top = await repo.addSection(1, 'Top');
    await repo.addSection(1, 'Other');
    expect(
      (await repo.addSection(1, 'Child', undefined, top.id)).position,
    ).toBe(0);
  });

  it('allows a parent that is the person’s and outside the section', async () => {
    const repo = new Repository(db);
    const a = await repo.addSection(1, 'A');
    const b = await repo.addSection(1, 'B', undefined, a.id);
    const c = await repo.addSection(1, 'C');
    const theirs = await repo.addSection(2, 'Theirs');
    expect(await repo.canNestUnder(1, c.id, b.id)).toBe(true);
    expect(await repo.canNestUnder(1, undefined, a.id)).toBe(true);
    expect(await repo.canNestUnder(1, a.id, a.id)).toBe(false);
    expect(await repo.canNestUnder(1, a.id, b.id)).toBe(false);
    expect(await repo.canNestUnder(1, c.id, theirs.id)).toBe(false);
    expect(await repo.canNestUnder(1, c.id, 999)).toBe(false);
  });

  it('moves a section under another, and back to the top level', async () => {
    const repo = new Repository(db);
    const a = await repo.addSection(1, 'A');
    const b = await repo.addSection(1, 'B');
    expect(
      (await repo.updateSection(1, b.id, { parent_id: a.id }))?.parent_id,
    ).toBe(a.id);
    expect(
      (await repo.updateSection(1, b.id, { parent_id: null }))?.parent_id,
    ).toBeNull();
  });

  it('moves the sections inside a removed one up to its parent', async () => {
    const repo = new Repository(db);
    const a = await repo.addSection(1, 'A');
    const b = await repo.addSection(1, 'B', undefined, a.id);
    const c = await repo.addSection(1, 'C', undefined, b.id);
    await repo.removeSection(1, b.id);
    expect((await repo.getSection(1, c.id))?.parent_id).toBe(a.id);
  });
});

const section = (
  id: number,
  name: string,
  parent_id: number | null,
): Section => ({
  id,
  user_id: 1,
  name,
  position: 0,
  parent_id,
  icon: null,
  auto_mark_read_days: null,
  created_at: null,
});

describe('treeOrder', () => {
  it('puts each section before the ones nested in it', () => {
    expect(
      treeOrder([section(2, 'Child', 1), section(1, 'Top', null)]).map(
        (s) => s.id,
      ),
    ).toEqual([1, 2]);
  });

  it('counts a section whose parent is gone as top level', () => {
    expect(treeOrder([section(2, 'Orphan', 9)]).map((s) => s.id)).toEqual([2]);
  });

  it('still lists sections caught in a loop', () => {
    expect(
      treeOrder([section(1, 'A', 2), section(2, 'B', 1)])
        .map((s) => s.id)
        .toSorted(),
    ).toEqual([1, 2]);
  });
});

describe('sectionAndDescendants', () => {
  it('finds a section and every section under it, however deep', () => {
    const all = [
      section(1, 'A', null),
      section(2, 'B', 1),
      section(3, 'C', 2),
      section(4, 'D', null),
    ];
    expect([...sectionAndDescendants(all, 1)].toSorted()).toEqual([1, 2, 3]);
  });
});

describe('sectionPath', () => {
  it('names a section after the sections it is in', () => {
    const all = [section(1, 'Tech', null), section(2, 'AI', 1)];
    expect(sectionPath(all, 2)).toBe('Tech · AI');
    expect(sectionPath(all, 1)).toBe('Tech');
  });

  it('stops at a loop rather than running forever', () => {
    expect(sectionPath([section(1, 'A', 2), section(2, 'B', 1)], 1)).toBe(
      'B · A',
    );
  });
});

describe('preferences', () => {
  it('gives the defaults to someone who changed nothing', async () => {
    expect(await new Repository(db).getPreferences(1)).toEqual(
      DEFAULT_PREFERENCES,
    );
  });

  it('keeps a change and the defaults beside it', async () => {
    const repo = new Repository(db);
    await repo.updatePreferences(1, { cluster_mode: 'title' });
    await repo.updatePreferences(1, { briefing_story_count: 15 });
    expect(await repo.getPreferences(1)).toEqual({
      ...DEFAULT_PREFERENCES,
      cluster_mode: 'title',
      briefing_story_count: 15,
    });
    expect(await repo.getPreferences(2)).toEqual(DEFAULT_PREFERENCES);
  });
});

describe('cluster siblings, issue lists and source counts', () => {
  const story = (n: number, over: Partial<ScrapedItem> = {}): ScrapedItem => ({
    url: `https://s.test/${n}`,
    title: 'Quake',
    source: 'S',
    favicon: '',
    summary: '',
    image: '',
    published_at: '',
    points: 0,
    ...over,
  });

  it('lists the other copies the person can read', async () => {
    const repo = new Repository(db);
    const user = await upsertUser(db, { sub: 'a', email: 'a@b.c' });
    const a = await addFeed(db, user.id, 'https://a.test/rss');
    const b = await addFeed(db, user.id, 'https://b.test/rss');
    await repo.writeEdition(a!.source_id, '2026-11-01', [story(1)]);
    await repo.writeEdition(b!.source_id, '2026-11-01', [story(2)]);
    await repo.writeEdition(99, '2026-11-01', [story(3)]);
    const ids = (await repo.editionArticles('2026-11-01')).map((x) => x.id);
    await repo.writeClusters('2026-11-01', [ids]);
    const [first, second] = ids;
    expect(await repo.clusterSiblingIds(user.id, first!)).toEqual([second]);
  });

  it('lists no copies of a story in no cluster, or not the person’s', async () => {
    const repo = new Repository(db);
    const user = await upsertUser(db, { sub: 'a', email: 'a@b.c' });
    const a = await addFeed(db, user.id, 'https://a.test/rss');
    await repo.writeEdition(a!.source_id, '2026-11-01', [story(1)]);
    const [only] = await repo.editionArticles('2026-11-01');
    expect(await repo.clusterSiblingIds(user.id, only!.id)).toEqual([]);
    expect(await repo.clusterSiblingIds(user.id + 1, only!.id)).toEqual([]);
  });

  it('carries the source title for clustering', async () => {
    const repo = new Repository(db);
    const user = await upsertUser(db, { sub: 'a', email: 'a@b.c' });
    const a = await addFeed(db, user.id, 'https://a.test/rss', 'Alpha');
    await repo.writeEdition(a!.source_id, '2026-11-01', [story(1)]);
    const [row] = await repo.editionArticles('2026-11-01');
    expect(row).toHaveProperty('feed_title');
  });

  it('lists a person’s issues newest first, before a date', async () => {
    const repo = new Repository(db);
    for (const d of ['2026-10-30', '2026-10-31', '2026-11-01']) {
      await repo.saveIssue(1, d, '{"groups":[]}', d);
    }
    await repo.saveIssue(2, '2026-11-01', '{"groups":[]}', null);
    expect((await repo.listIssues(1, 2)).map((i) => i.date)).toEqual([
      '2026-11-01',
      '2026-10-31',
    ]);
    expect(
      (await repo.listIssues(1, 5, '2026-10-31')).map((i) => i.date),
    ).toEqual(['2026-10-30']);
  });

  it('keeps the stories a stored note covers', async () => {
    const repo = new Repository(db);
    await repo.saveIssue(1, '2026-11-01', '{"groups":[]}', 'N', '[1]');
    expect((await repo.getIssue(1, '2026-11-01'))?.briefing_stories).toBe(
      '[1]',
    );
  });

  it('counts each source’s stories since a date', async () => {
    const repo = new Repository(db);
    await repo.writeEdition(1, '2026-10-01', [story(1)]);
    await repo.writeEdition(1, '2026-10-20', [story(2), story(3)]);
    const counts = await repo.sourceCounts([1, 2], '2026-10-15');
    expect(counts.get(1)).toBe(2);
    expect(counts.has(2)).toBe(false);
  });

  it('lists the sources of what a person read', async () => {
    const repo = new Repository(db);
    const user = await upsertUser(db, { sub: 'a', email: 'a@b.c' });
    const a = await addFeed(db, user.id, 'https://a.test/rss');
    await repo.writeEdition(a!.source_id, '2026-11-01', [story(1)]);
    const [row] = await repo.editionArticles('2026-11-01');
    await repo.markRead(user.id, row!.id);
    expect([...(await repo.readSourceIds(user.id))]).toEqual([a!.source_id]);
  });
});

describe('feeds in several sections', () => {
  it('files a feed in several sections, printing under the first', async () => {
    const repo = new Repository(db);
    const a = await repo.addSection(1, 'A');
    const b = await repo.addSection(1, 'B');
    const feed = (await addFeed(db, 1, 'https://a.test/f'))!;
    expect(
      await repo.updateFeed(1, feed.id, { section_ids: [b.id, a.id] }),
    ).toMatchObject({ section_id: b.id, section_ids: [b.id, a.id] });
    expect(
      (await repo.updateFeed(1, feed.id, { section_ids: [] }))?.section_ids,
    ).toEqual([]);
  });

  it('keeps the other sections when only the print section changes', async () => {
    const repo = new Repository(db);
    const a = await repo.addSection(1, 'A');
    const b = await repo.addSection(1, 'B');
    const c = await repo.addSection(1, 'C');
    const feed = (await addFeed(db, 1, 'https://a.test/f'))!;
    await repo.updateFeed(1, feed.id, { section_ids: [a.id, b.id] });
    expect(
      (await repo.updateFeed(1, feed.id, { section_id: c.id }))?.section_ids,
    ).toEqual([c.id, b.id]);
    expect(
      (await repo.updateFeed(1, feed.id, { section_id: b.id }))?.section_ids,
    ).toEqual([b.id]);
  });

  it('moves a feed to its next section when its print section is removed', async () => {
    const repo = new Repository(db);
    const a = await repo.addSection(1, 'A');
    const b = await repo.addSection(1, 'B');
    const feed = (await addFeed(db, 1, 'https://a.test/f'))!;
    await repo.updateFeed(1, feed.id, { section_ids: [a.id, b.id] });
    await repo.removeSection(1, a.id);
    expect((await repo.getFeed(1, feed.id))?.section_ids).toEqual([b.id]);
  });

  it('forgets the sections of a feed that is unfollowed', async () => {
    const repo = new Repository(db);
    const a = await repo.addSection(1, 'A');
    const b = await repo.addSection(1, 'B');
    const feed = (await addFeed(db, 1, 'https://a.test/f'))!;
    await repo.updateFeed(1, feed.id, { section_ids: [a.id, b.id] });
    await repo.removeFeed(1, feed.id);
    expect((await addFeed(db, 1, 'https://a.test/f'))?.section_ids).toEqual([]);
  });
});

describe('moveFeeds and removeFeeds', () => {
  it('moves only the caller’s feeds and counts them', async () => {
    const repo = new Repository(db);
    const s = await repo.addSection(1, 'S');
    const a = (await addFeed(db, 1, 'https://a.test/a'))!;
    const theirs = (await addFeed(db, 2, 'https://a.test/b'))!;
    expect(await repo.moveFeeds(1, [a.id, a.id, theirs.id, 999], s.id)).toBe(1);
    expect((await repo.getFeed(1, a.id))?.section_id).toBe(s.id);
    expect((await repo.getFeed(2, theirs.id))?.section_id).toBeNull();
  });

  it('removes only the caller’s feeds and counts them', async () => {
    const repo = new Repository(db);
    const a = (await addFeed(db, 1, 'https://a.test/a'))!;
    const theirs = (await addFeed(db, 2, 'https://a.test/b'))!;
    expect(await repo.removeFeeds(1, [a.id, theirs.id])).toBe(1);
    expect(await listFeeds(db, 1)).toEqual([]);
    expect(await listFeeds(db, 2)).toHaveLength(1);
  });
});

describe('removeSection with its feeds', () => {
  it('unfollows the feeds only inside it and removes the sections in it', async () => {
    const repo = new Repository(db);
    const top = await repo.addSection(1, 'Top');
    const inner = await repo.addSection(1, 'Inner', undefined, top.id);
    const other = await repo.addSection(1, 'Other');
    const only = (await addFeed(db, 1, 'https://a.test/only'))!;
    const deep = (await addFeed(db, 1, 'https://a.test/deep'))!;
    const shared = (await addFeed(db, 1, 'https://a.test/shared'))!;
    const loose = (await addFeed(db, 1, 'https://a.test/loose'))!;
    await repo.updateFeed(1, only.id, { section_id: top.id });
    await repo.updateFeed(1, deep.id, { section_id: inner.id });
    await repo.updateFeed(1, shared.id, { section_ids: [top.id, other.id] });
    expect(await repo.removeSection(1, top.id, true)).toBe(true);
    expect((await repo.listSections(1)).map((s) => s.name)).toEqual(['Other']);
    expect((await listFeeds(db, 1)).map((f) => [f.id, f.section_ids])).toEqual([
      [shared.id, [other.id]],
      [loose.id, []],
    ]);
  });

  it('removes nothing of another person’s', async () => {
    const repo = new Repository(db);
    const s = await repo.addSection(1, 'S');
    expect(await repo.removeSection(2, s.id, true)).toBe(false);
    expect(await repo.listSections(1)).toHaveLength(1);
  });
});

describe('section icons and days', () => {
  it('stores an icon and the days, and clears them', async () => {
    const repo = new Repository(db);
    const s = await repo.addSection(1, 'S');
    expect(
      await repo.updateSection(1, s.id, {
        icon: '{"type":"emoji","data":"📰"}',
        auto_mark_read_days: 3,
      }),
    ).toMatchObject({
      icon: '{"type":"emoji","data":"📰"}',
      auto_mark_read_days: 3,
    });
    expect(
      await repo.updateSection(1, s.id, {
        icon: null,
        auto_mark_read_days: null,
      }),
    ).toMatchObject({ icon: null, auto_mark_read_days: null });
  });
});

describe('listEditions with a timed mute', () => {
  it('counts a feed whose mute has run out', async () => {
    const repo = new Repository(db);
    const feed = (await addFeed(db, 1, 'https://a.test/f'))!;
    await repo.writeEdition(feed.source_id, '2026-10-20', [
      {
        url: 'https://x/1',
        title: 'One',
        source: '',
        favicon: '',
        summary: '',
        image: '',
        published_at: '',
        points: 0,
      },
    ]);
    await repo.updateFeed(1, feed.id, {
      muted: true,
      muted_until: '2000-01-01 00:00:00',
    });
    expect(await repo.listEditions(1)).toEqual(['2026-10-20']);
  });
});

const filed = (section_id: number | null, days: number | null = null) =>
  ({
    section_id,
    section_ids: section_id === null ? [] : [section_id],
    auto_mark_read_days: days,
  }) as unknown as Parameters<typeof autoMarkReadDays>[0];

describe('autoMarkReadDays', () => {
  const sections = [
    { ...section(1, 'Top', null), auto_mark_read_days: 30 },
    section(2, 'Mid', 1),
    { ...section(3, 'Off', 1), auto_mark_read_days: 0 },
  ];

  it('takes the feed’s own setting first', () => {
    expect(autoMarkReadDays(filed(2, 5), sections)).toBe(5);
    expect(autoMarkReadDays(filed(2, 0), sections)).toBeUndefined();
  });

  it('inherits from the nearest section above that has one', () => {
    expect(autoMarkReadDays(filed(2), sections)).toBe(30);
  });

  it('reads 0 on a section as never', () => {
    expect(autoMarkReadDays(filed(3), sections)).toBeUndefined();
  });

  it('marks nothing read for a feed under no section', () => {
    expect(autoMarkReadDays(filed(null), sections)).toBeUndefined();
  });
});

describe('filedIn', () => {
  it('matches a feed filed in any of the sections', () => {
    const feed = { ...filed(1), section_ids: [1, 4] } as Parameters<
      typeof filedIn
    >[0];
    expect(filedIn(feed, new Set([4]))).toBe(true);
    expect(filedIn(feed, new Set([2]))).toBe(false);
  });
});

describe('sectionNames', () => {
  it('lists the names from the outermost section in', () => {
    expect(
      sectionNames([section(1, 'Tech', null), section(2, 'AI', 1)], 2),
    ).toEqual(['Tech', 'AI']);
  });
});

describe('archive helpers', () => {
  /** Person 1 follows a feed with two stories in today's edition. */
  async function seeded() {
    await upsertUser(db, { sub: 'g1', email: 'a@b.com' });
    const repo = new Repository(db);
    const feed = (await repo.addFeed(1, 'https://a.test/f'))!;
    const today = new Date().toISOString().slice(0, 10);
    const story = (url: string, title: string): ScrapedItem => ({
      url,
      title,
      source: 'a.test',
      image: '',
      favicon: '',
      summary: '',
      published_at: '',
      points: 0,
    });
    await repo.writeEdition(feed.source_id, today, [
      story('https://a.test/1', 'One'),
      story('https://www.a.test/2', 'Two'),
    ]);
    const ids = (await repo.searchArticles(1, { limit: 5 })).map((a) => a.id);
    return { repo, feed, ids, today };
  }

  it('annotates a save, and only a save', async () => {
    const { repo, ids } = await seeded();
    await repo.saveArticle(1, ids[0]!, []);
    expect([
      await repo.annotateSave(1, ids[0]!, { notes: 'n', highlights: ['h'] }),
      await repo.annotateSave(1, ids[1]!, { notes: 'n' }),
    ]).toEqual([
      expect.objectContaining({ notes: 'n', highlights: ['h'] }),
      undefined,
    ]);
  });

  it('counts stories per month and unread stories per feed', async () => {
    const { repo, feed, ids } = await seeded();
    await repo.markRead(1, ids[0]!);
    expect([
      (await repo.storiesPerMonth(1)).get(feed.id),
      (await repo.unreadCounts(1)).get(feed.id),
    ]).toEqual([2, 1]);
  });

  it('sums up the archive', async () => {
    const { repo, feed, today } = await seeded();
    expect(await repo.archiveStats(1)).toEqual({
      articles: 2,
      editions: 1,
      oldest_edition: today,
      newest_edition: today,
      saved: 0,
      read: 0,
      feeds: [{ feed_id: feed.id, title: 'https://a.test/f', articles: 2 }],
    });
  });

  it('searches by site, including the sites under it', async () => {
    const { repo } = await seeded();
    const titles = async (domain: string) =>
      (await repo.searchArticles(1, { domain, limit: 5 })).map((a) => a.title);
    expect([await titles('a.test'), await titles('b.test')]).toEqual([
      ['Two', 'One'],
      [],
    ]);
  });

  it('lists oldest first, continuing after an id', async () => {
    const { repo, ids } = await seeded();
    const oldest = await repo.searchArticles(1, { oldest: true, limit: 5 });
    const after = await repo.searchArticles(1, {
      oldest: true,
      before: oldest[0]!.id,
      limit: 5,
    });
    expect([oldest.map((a) => a.id), after.length]).toEqual([
      [...ids].reverse(),
      1,
    ]);
  });

  it('narrows to feeds and editions, only the caller’s feeds', async () => {
    const { repo, feed, today } = await seeded();
    expect([
      (await repo.searchArticles(1, { feeds: [feed.id], limit: 5 })).length,
      (await repo.searchArticles(2, { feeds: [feed.id], limit: 5 })).length,
      (await repo.searchArticles(1, { to: '2000-01-01', limit: 5 })).length,
      (await repo.searchArticles(1, { from: today, limit: 5 })).length,
    ]).toEqual([2, 0, 0, 2]);
  });
});

describe('conversationTitle', () => {
  it('cuts a long first question to fifty characters', () => {
    expect(conversationTitle(`  ${'a'.repeat(60)} `)).toBe(
      `${'a'.repeat(50)}…`,
    );
    expect(conversationTitle('short  one')).toBe('short one');
  });
});

describe('answers cache and usage', () => {
  it('keeps and replaces an answer per person, article and question', async () => {
    const repo = new Repository(db);
    await repo.storeAnswer(1, 5, 'bullets', 'A');
    await repo.storeAnswer(1, 5, 'bullets', 'B');
    expect(await repo.cachedAnswer(1, 5, 'bullets')).toBe('B');
    expect(await repo.cachedAnswer(2, 5, 'bullets')).toBeUndefined();
  });

  it('counts questions since a time, leaving out cached ones and other kinds', async () => {
    const repo = new Repository(db);
    await repo.recordUsage(1, 'answer');
    await repo.recordUsage(1, 'answer', true);
    await repo.recordUsage(1, 'assistant');
    expect(await repo.usageSince(1, 'answer', '2000-01-01 00:00:00')).toBe(1);
    expect(await repo.usageSince(1, 'answer', '2999-01-01 00:00:00')).toBe(0);
  });
});

describe('listing and removing conversations', () => {
  it('titles a conversation by its first question and lists the last active first', async () => {
    const repo = new Repository(db);
    const a = await repo.addConversation(1);
    const b = await repo.addConversation(1);
    await repo.touchConversation(a.id, 'First question');
    await repo.touchConversation(a.id, 'Second question');
    await db.run(
      sql`UPDATE conversations SET updated_at = '2000-01-01 00:00:00' WHERE id = ${b.id}`,
    );
    const listed = await repo.listConversations(1);
    expect(listed.map((c) => [c.id, c.title])).toEqual([
      [a.id, 'First question'],
      [b.id, null],
    ]);
    expect(await repo.listConversations(2)).toEqual([]);
  });

  it('removes only the owner’s conversation, with its turns', async () => {
    const repo = new Repository(db);
    const c = await repo.addConversation(1);
    await repo.addMessage(c.id, 'user', 'Q');
    expect(await repo.removeConversation(2, c.id)).toBe(false);
    expect(await repo.removeConversation(1, c.id)).toBe(true);
    expect(await repo.listMessages(c.id)).toEqual([]);
    expect(await repo.removeConversation(1, c.id)).toBe(false);
  });
});

describe('similarSources', () => {
  it('suggests what followers of one feed’s source also follow, with headlines', async () => {
    const repo = new Repository(db);
    const mine = (await addFeed(db, 1, 'https://shared.test/f'))!;
    await addFeed(db, 2, 'https://shared.test/f');
    const extra = (await addFeed(db, 2, 'https://extra.test/f'))!;
    await addFeed(db, 3, 'https://unrelated.test/f');
    await repo.writeEdition(extra.source_id, '2026-10-20', [
      story({ title: 'Headline' }),
    ]);
    const found = await repo.similarSources(1, mine.id);
    expect(found).toEqual([
      expect.objectContaining({
        url: 'https://extra.test/f',
        followers: 1,
        stories: [expect.objectContaining({ title: 'Headline' })],
      }),
    ]);
  });

  it('is undefined for someone else’s feed', async () => {
    const theirs = (await addFeed(db, 2, 'https://shared.test/f'))!;
    expect(
      await new Repository(db).similarSources(1, theirs.id),
    ).toBeUndefined();
  });
});

describe('discoverArticles', () => {
  it('finds stories from any source sharing title words, flagging unfollowed ones', async () => {
    const repo = new Repository(db);
    const a = (await addFeed(db, 1, 'https://a.test/f'))!;
    const b = (await addFeed(db, 2, 'https://b.test/f'))!;
    await repo.writeEdition(a.source_id, '2026-10-20', [
      story({ url: 'https://x/1', title: 'Quantum computing breakthrough' }),
    ]);
    await repo.writeEdition(b.source_id, '2026-10-20', [
      story({ url: 'https://x/2', title: 'Quantum chips arrive' }),
      story({ url: 'https://x/1', title: 'Quantum computing breakthrough' }),
    ]);
    const [mine] = await repo.sourceArticles(a.source_id, '2026-10-20');
    const found = await repo.discoverArticles(1, mine!.id);
    expect(found?.map((s) => [s.article.url, s.followed])).toEqual([
      ['https://x/2', false],
    ]);
  });

  it('is undefined for an article the person cannot reach', async () => {
    const repo = new Repository(db);
    const b = (await addFeed(db, 2, 'https://b.test/f'))!;
    await repo.writeEdition(b.source_id, '2026-10-20', [story({})]);
    const [theirs] = await repo.sourceArticles(b.source_id, '2026-10-20');
    expect(await repo.discoverArticles(1, theirs!.id)).toBeUndefined();
  });
});
