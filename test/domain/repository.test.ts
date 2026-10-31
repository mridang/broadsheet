import { beforeEach, describe, expect, it } from '@jest/globals';

import { databaseFrom, type Database } from '@/domain/db/database';
import { Repository, type Profile } from '@/domain/repository';
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
