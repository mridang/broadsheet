import { beforeEach, describe, expect, it } from '@jest/globals';
import { sql } from 'drizzle-orm';

import { databaseFrom, type Database } from '@/domain/db/database';
import {
  anyWordQuery,
  ftsQuery,
  Repository,
  sectionAndDescendants,
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
    expect(await repo.feedStatistics(1, feed.id)).toEqual({
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
