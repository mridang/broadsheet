import { beforeEach, describe, expect, it } from '@jest/globals';

import { createDatabase, type Database } from '@/domain/db/client';
import { Repository } from '@/domain/repository';
import {
  frontPageRivers,
  ownsTarget,
  parseRiverId,
  RiverRepository,
  riverChoices,
  riverStories,
} from '@/domain/rivers';
import { APP_MIGRATIONS } from '../lib/core/db/migrations';
import { sqliteD1 } from '../lib/core/db/sqlite-d1';

const DAY = '2026-11-01';

let db: Database;
let uid: number;
let feedId: number;

const story = (n: number, title: string) => ({
  url: `https://r.test/${n}`,
  title,
  source: '',
  favicon: '',
  summary: '',
  image: '',
  published_at: '',
  points: 0,
});

beforeEach(async () => {
  db = createDatabase(sqliteD1(...APP_MIGRATIONS).d1);
  const repo = new Repository(db);
  const user = await repo.upsertUser({ sub: 'g', email: 'a@b.c' });
  uid = user.id;
  const feed = (await repo.addFeed(uid, 'https://r.test/rss', 'R'))!;
  feedId = feed.id;
  await repo.writeEdition(feed.source_id, DAY, [
    story(1, 'Rust one'),
    story(2, 'Go two'),
  ]);
});

describe('parseRiverId', () => {
  it.each([
    ['all', { kind: 'all' }],
    ['saves', { kind: 'saves' }],
    ['feed:3', { kind: 'feed', id: 3 }],
    ['edition:12', { kind: 'edition', id: 12 }],
  ])('reads %s', (riverId, target) => {
    expect(parseRiverId(riverId)).toEqual(target);
  });

  it.each(['river:', 'feed:0', 'feed:x', 'section:', 'folder:1'])(
    'refuses %s',
    (riverId) => {
      expect(parseRiverId(riverId)).toBeUndefined();
    },
  );
});

describe('RiverRepository', () => {
  it('pins a river, and changes what the river at a taken place lists', async () => {
    const rivers = new RiverRepository(db);
    const first = await rivers.place(uid, {
      river_id: 'all',
      side: 'left',
      position: 0,
    });
    expect(first.created).toBe(true);
    const moved = await rivers.place(uid, {
      river_id: 'saves',
      side: 'left',
      position: 0,
    });
    expect(moved).toMatchObject({
      created: false,
      river: { id: first.river.id, river_id: 'saves' },
    });
  });

  it('replaces every river, listing left then right in order', async () => {
    const rivers = new RiverRepository(db);
    await rivers.place(uid, { river_id: 'all', side: 'left', position: 0 });
    const list = await rivers.replace(uid, [
      { river_id: 'saves', side: 'right', position: 0 },
      { river_id: 'all', side: 'left', position: 1 },
      { river_id: `feed:${feedId}`, side: 'left', position: 0 },
    ]);
    expect(list.map((r) => r.river_id)).toEqual([
      `feed:${feedId}`,
      'all',
      'saves',
    ]);
  });

  it('closes the gap a removed river leaves in its column', async () => {
    const rivers = new RiverRepository(db);
    const [top] = await rivers.replace(uid, [
      { river_id: 'all', side: 'left', position: 0 },
      { river_id: 'saves', side: 'left', position: 1 },
      { river_id: `feed:${feedId}`, side: 'right', position: 0 },
    ]);
    expect(await rivers.remove(uid, top!.id)).toBe(true);
    const listed = await rivers.list(uid);
    expect(listed.map((r) => [r.river_id, r.side, r.position])).toEqual([
      ['saves', 'left', 0],
      [`feed:${feedId}`, 'right', 0],
    ]);
  });

  it('never removes another person’s river', async () => {
    const rivers = new RiverRepository(db);
    const { river } = await rivers.place(uid, {
      river_id: 'all',
      side: 'left',
      position: 0,
    });
    expect(await rivers.remove(uid + 1, river.id)).toBe(false);
    expect(await rivers.list(uid)).toHaveLength(1);
  });
});

describe('ownsTarget', () => {
  it('owns its own feed and not another person’s', async () => {
    expect(await ownsTarget(db, uid, { kind: 'feed', id: feedId })).toBe(true);
    expect(await ownsTarget(db, uid + 1, { kind: 'feed', id: feedId })).toBe(
      false,
    );
  });
});

describe('riverStories', () => {
  it('lists a feed, a saved search and every feed, newest first', async () => {
    const { search } = await new Repository(db).addSearch(uid, 'rust', null);
    const titles = async (riverId: string) => {
      const stories = await riverStories(db, uid, riverId, 5);
      return stories.map((a) => a.title);
    };
    expect(await titles(`feed:${feedId}`)).toEqual(['Go two', 'Rust one']);
    expect(await titles(`search:${search.id}`)).toEqual(['Rust one']);
    expect(await titles('all')).toEqual(['Go two', 'Rust one']);
  });

  it('lists a section’s feeds and the person’s saves', async () => {
    const repo = new Repository(db);
    const section = await repo.addSection(uid, 'Tech');
    await repo.updateFeed(uid, feedId, { section_id: section.id });
    const [first] = await repo.searchArticles(uid, { limit: 1 });
    await repo.saveArticle(uid, first!.id, []);
    expect(
      await riverStories(db, uid, `section:${section.id}`, 1),
    ).toHaveLength(1);
    const saved = await riverStories(db, uid, 'saves', 5);
    expect(saved.map((a) => a.id)).toEqual([first!.id]);
  });

  it('lists a custom edition’s stories', async () => {
    const edition = await new Repository(db).addCustomEdition(uid, {
      name: 'Rusty',
      query: 'rust',
    });
    const stories = await riverStories(db, uid, `edition:${edition.id}`, 5);
    expect(stories.map((a) => a.title)).toEqual(['Rust one']);
  });

  it('lists nothing for what is gone or not the person’s', async () => {
    expect(await riverStories(db, uid, 'search:99', 5)).toEqual([]);
    expect(await riverStories(db, uid + 1, `feed:${feedId}`, 5)).toEqual([]);
    expect(await riverStories(db, uid, 'nonsense', 5)).toEqual([]);
  });
});

describe('frontPageRivers', () => {
  it('fills each pinned river and offers what another could list', async () => {
    await new RiverRepository(db).place(uid, {
      river_id: `feed:${feedId}`,
      side: 'right',
      position: 0,
    });
    await new RiverRepository(db).place(uid, {
      river_id: 'search:99',
      side: 'left',
      position: 0,
    });
    const { rivers, options } = await frontPageRivers(db, uid);
    expect(rivers.map((r) => [r.label, r.stories.length])).toEqual([['R', 2]]);
    const choices = await riverChoices(db, uid);
    expect(options.map((o) => o.river_id)).toEqual(
      choices.map((o) => o.river_id),
    );
    expect(options.map((o) => o.river_id)).toContain('saves');
  });
});
