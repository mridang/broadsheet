import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { databaseFrom, type Database } from '@/domain/db/database';
import {
  briefingFor,
  composeLayout,
  dayBefore,
  editionIssueFor,
  editionPick,
  isIssueDate,
  issueFor,
  publishEditionIssue,
  publishIssue,
  storedEditionIssue,
  storedIssue,
} from '@/domain/issues';
import { storyIds } from '@/domain/render/layout';
import {
  DEFAULT_PREFERENCES,
  Repository,
  type CustomEdition,
} from '@/domain/repository';
import type { ScrapedItem } from '@/lib/scraping';
import { APP_MIGRATIONS } from '../lib/core/db/migrations';
import { sqliteD1 } from '../lib/core/db/sqlite-d1';

const DAY = '2026-11-01';

const item = (n: number, over: Partial<ScrapedItem> = {}): ScrapedItem => ({
  url: `https://x.test/${n}`,
  title: `Story ${n}`,
  source: 'X',
  favicon: '',
  summary: '',
  image: '',
  published_at: '',
  points: n,
  ...over,
});

/** An env whose model answers with `response`, or throws when it is an Error. */
const envWith = (response: unknown) =>
  ({
    AI: {
      run: jest.fn(async () => {
        if (response instanceof Error) throw response;
        return { response };
      }),
    },
  }) as unknown as CloudflareEnv;

let db: Database;
let repo: Repository;
let uid: number;
let sourceId: number;

beforeEach(async () => {
  db = databaseFrom(sqliteD1(...APP_MIGRATIONS).d1);
  repo = new Repository(db);
  uid = (await repo.upsertUser({ sub: 'g', email: 'a@b.c' })).id;
  const feed = await repo.addFeed(uid, 'https://x.test/rss', 'X');
  sourceId = feed!.source_id;
  await repo.writeEdition(sourceId, DAY, [item(1), item(2)]);
});

describe('composeLayout copies from other days', () => {
  it('names a copy of a story from an earlier edition', async () => {
    const other = await repo.addFeed(uid, 'https://y.test/rss', 'Y');
    await repo.writeEdition(other!.source_id, '2026-10-31', [
      item(1, { url: 'https://y.test/1', source: 'Y' }),
    ]);
    const ids = (await repo.windowArticles('2026-10-31', DAY))
      .filter((a) => a.title === 'Story 1')
      .map((a) => a.id);
    await repo.writeWindowClusters('2026-10-31', DAY, [ids]);
    const layout = await composeLayout(repo, uid, DAY, uid);
    const story = layout.groups
      .flatMap((g) => g.desks.flatMap((d) => d.stories))
      .find((s) => (s.siblings ?? []).length);
    expect(story?.also).toEqual(['Y']);
  });
});

describe('composeLayout', () => {
  it('prints every copy of a clustered story when the reader turned clustering off', async () => {
    const other = await repo.addFeed(uid, 'https://y.test/rss', 'Y');
    await repo.writeEdition(other!.source_id, DAY, [
      item(1, { url: 'https://y.test/1' }),
    ]);
    const ids = (await repo.editionArticles(DAY))
      .filter((a) => a.title === 'Story 1')
      .map((a) => a.id);
    await repo.writeClusters(DAY, [ids]);
    expect(storyIds(await composeLayout(repo, uid, DAY, uid))).toHaveLength(2);
    await repo.updatePreferences(uid, { story_clustering: false });
    expect(storyIds(await composeLayout(repo, uid, DAY, uid))).toHaveLength(3);
  });

  it('lays out the day’s stories of the person’s feeds', async () => {
    const layout = await composeLayout(repo, uid, DAY, uid);
    expect(storyIds(layout)).toHaveLength(2);
  });

  it('leaves out a muted feed', async () => {
    const [feed] = await repo.listFeeds(uid);
    await repo.updateFeed(uid, feed!.id, { muted: true });
    expect((await composeLayout(repo, uid, DAY)).groups).toEqual([]);
  });

  it('leaves out a story the reader read in another edition', async () => {
    await repo.writeEdition(sourceId, '2026-10-31', [item(1)]);
    const [old] = await repo.sourceArticles(sourceId, '2026-10-31');
    await repo.markRead(uid, old!.id);
    const layout = await composeLayout(repo, uid, DAY, uid);
    expect(storyIds(layout)).toHaveLength(1);
  });

  it('files a feed under its section', async () => {
    const section = await repo.addSection(uid, 'Tech');
    const [feed] = await repo.listFeeds(uid);
    await repo.updateFeed(uid, feed!.id, { section_id: section.id });
    const layout = await composeLayout(repo, uid, DAY);
    expect(layout.groups.map((g) => g.name)).toEqual(['Tech']);
  });

  it('heads a nested section with the sections it is in', async () => {
    const tech = await repo.addSection(uid, 'Tech');
    const ai = await repo.addSection(uid, 'AI', undefined, tech.id);
    const [feed] = await repo.listFeeds(uid);
    await repo.updateFeed(uid, feed!.id, { section_id: ai.id });
    const layout = await composeLayout(repo, uid, DAY);
    expect(layout.groups.map((g) => g.name)).toEqual(['Tech · AI']);
  });

  it('leaves out, for the reader, stories older than a section marks read after', async () => {
    const section = await repo.addSection(uid, 'Tech');
    await repo.updateSection(uid, section.id, { auto_mark_read_days: 1 });
    const [feed] = await repo.listFeeds(uid);
    await repo.updateFeed(uid, feed!.id, { section_id: section.id });
    await repo.writeEdition(sourceId, '2000-01-01', [item(3)]);
    expect(storyIds(await composeLayout(repo, uid, '2000-01-01', uid))).toEqual(
      [],
    );
    expect(storyIds(await composeLayout(repo, uid, '2000-01-01'))).toHaveLength(
      1,
    );
  });

  it('lets a feed set to never mark read override its section', async () => {
    const section = await repo.addSection(uid, 'Tech');
    await repo.updateSection(uid, section.id, { auto_mark_read_days: 1 });
    const [feed] = await repo.listFeeds(uid);
    await repo.updateFeed(uid, feed!.id, {
      section_id: section.id,
      auto_mark_read_days: 0,
    });
    await repo.writeEdition(sourceId, '2000-01-01', [item(3)]);
    expect(
      storyIds(await composeLayout(repo, uid, '2000-01-01', uid)),
    ).toHaveLength(1);
  });

  it('prints a feed filed in two sections once, under its print section', async () => {
    const tech = await repo.addSection(uid, 'Tech');
    const news = await repo.addSection(uid, 'News');
    const [feed] = await repo.listFeeds(uid);
    await repo.updateFeed(uid, feed!.id, { section_ids: [news.id, tech.id] });
    const layout = await composeLayout(repo, uid, DAY);
    expect(layout.groups.map((g) => g.name)).toEqual(['News']);
  });

  it('prints a feed again once its timed mute has run out', async () => {
    const [feed] = await repo.listFeeds(uid);
    await repo.updateFeed(uid, feed!.id, {
      muted: true,
      muted_until: '2000-01-01 00:00:00',
    });
    expect(storyIds(await composeLayout(repo, uid, DAY))).toHaveLength(2);
  });
});

describe('publishIssue', () => {
  // A note needs three stories.
  beforeEach(async () => {
    await repo.writeEdition(sourceId, DAY, [item(1), item(2), item(3)]);
  });

  it('stores the layout, the note and the stories it covers', async () => {
    expect(await publishIssue(db, envWith('Note.'), uid, DAY)).toBe(3);
    const issue = await storedIssue(repo, uid, DAY);
    expect(issue?.briefing).toBe('Note.');
    expect(storyIds(issue!.layout)).toHaveLength(3);
    expect(issue?.briefing_stories).toHaveLength(3);
    expect(issue?.briefing_stories[0]).toMatchObject({
      category: 'infrequent',
    });
  });

  it('judges the stories against the reader’s AI prompts first', async () => {
    const { classifier } = await repo.addClassifier(uid, {
      kind: 'prompt',
      value: 'anything',
      score: 1,
    });
    const env = envWith('yes');
    await publishIssue(db, env, uid, DAY);
    expect((await repo.promptMatches(uid)).size).toBe(3);
    expect(
      [...(await repo.promptMatches(uid)).values()][0]?.has(classifier.id),
    ).toBe(true);
  });

  it('replaces the day’s issue when run again', async () => {
    await publishIssue(db, envWith('First.'), uid, DAY);
    await publishIssue(db, envWith('Second.'), uid, DAY);
    expect((await storedIssue(repo, uid, DAY))?.briefing).toBe('Second.');
  });

  it('asks the model nothing when the reader turned the note off', async () => {
    await repo.updatePreferences(uid, { briefing_enabled: false });
    const env = envWith('Note.');
    await publishIssue(db, env, uid, DAY);
    expect(env.AI.run).not.toHaveBeenCalled();
    expect(await storedIssue(repo, uid, DAY)).toMatchObject({
      briefing: null,
      briefing_stories: [],
    });
  });

  it('stores no note when too few stories qualify', async () => {
    await repo.writeEdition(sourceId, DAY, [item(1), item(2)]);
    const env = envWith('Note.');
    await publishIssue(db, env, uid, DAY);
    expect(env.AI.run).not.toHaveBeenCalled();
  });

  it('covers the reader’s chosen number of stories', async () => {
    await repo.writeEdition(
      sourceId,
      DAY,
      Array.from({ length: 12 }, (_, i) => item(i + 1)),
    );
    // One source gives at most three, whatever the count.
    await repo.updatePreferences(uid, { briefing_story_count: 10 });
    await publishIssue(db, envWith('Note.'), uid, DAY);
    expect((await storedIssue(repo, uid, DAY))?.briefing_stories).toHaveLength(
      3,
    );
  });
});

describe('briefingFor', () => {
  it('leaves out stories the previous note covered', async () => {
    await repo.writeEdition(sourceId, DAY, [
      item(1),
      item(2),
      item(3),
      item(4),
    ]);
    const layout = await composeLayout(repo, uid, DAY, uid);
    const all = await repo.sourceArticles(sourceId, DAY);
    const story4 = all.find((a) => a.title === 'Story 4')!;
    const before = await briefingFor(
      repo,
      envWith('Note.'),
      uid,
      layout,
      DAY,
      DEFAULT_PREFERENCES,
    );
    expect(before.briefed.map((b) => b.id)).toContain(story4.id);
    const after = await briefingFor(
      repo,
      envWith('Note.'),
      uid,
      layout,
      DAY,
      DEFAULT_PREFERENCES,
      JSON.stringify([{ id: story4.id, category: 'top_stories' }]),
    );
    expect(after.briefed.map((b) => b.id)).not.toContain(story4.id);
  });

  it('stores no stories when the model wrote no note', async () => {
    await repo.writeEdition(sourceId, DAY, [item(1), item(2), item(3)]);
    const layout = await composeLayout(repo, uid, DAY, uid);
    expect(
      (
        await briefingFor(
          repo,
          envWith(''),
          uid,
          layout,
          DAY,
          DEFAULT_PREFERENCES,
        )
      ).briefed,
    ).toEqual([]);
  });
});

describe('dayBefore', () => {
  it('steps back over a month end', () => {
    expect(dayBefore('2026-11-01')).toBe('2026-10-31');
  });
});

describe('storedIssue', () => {
  it('is undefined for a day with no issue', async () => {
    expect(await storedIssue(repo, uid, DAY)).toBeUndefined();
  });

  it('is undefined when the stored layout does not read', async () => {
    await repo.saveIssue(uid, DAY, '{', null);
    expect(await storedIssue(repo, uid, DAY)).toBeUndefined();
  });
});

describe('issueFor', () => {
  it('reads the stored issue when there is one', async () => {
    await repo.saveIssue(uid, DAY, '{"groups":[]}', 'Kept.');
    expect(await issueFor(repo, uid, DAY)).toMatchObject({
      briefing: 'Kept.',
      layout: { groups: [] },
    });
  });

  it('lays the day out live when none was stored', async () => {
    const issue = await issueFor(repo, uid, DAY);
    expect(issue).toMatchObject({ briefing: null, created_at: null });
    expect(storyIds(issue.layout)).toHaveLength(2);
  });
});

describe('isIssueDate', () => {
  it.each(['2026-11-01', '2024-02-29'])('accepts %s', (d) => {
    expect(isIssueDate(d)).toBe(true);
  });

  it.each(['2026-13-01', '2026-02-30', '20261101', 'latest', '2026-1-1'])(
    'refuses %s',
    (d) => {
      expect(isIssueDate(d)).toBe(false);
    },
  );
});

describe('custom editions', () => {
  const edition = (over: Partial<CustomEdition> = {}): CustomEdition => ({
    id: 1,
    user_id: uid,
    name: 'Weekend',
    section_ids: [],
    query: null,
    tag: null,
    created_at: null,
    ...over,
  });

  it('prints every feed when the edition has no rules', async () => {
    const pick = await editionPick(repo, edition(), DAY);
    expect(pick.keep).toBeUndefined();
    const layout = await composeLayout(repo, uid, DAY, uid, pick);
    expect(storyIds(layout)).toHaveLength(2);
  });

  it('keeps only the stories matching its search', async () => {
    const layout = await composeLayout(
      repo,
      uid,
      DAY,
      uid,
      await editionPick(repo, edition({ query: 'story 2' }), DAY),
    );
    const ids = storyIds(layout);
    expect(ids).toHaveLength(1);
    expect((await repo.articlesByIds(ids))[0]?.title).toBe('Story 2');
  });

  it('keeps only the stories saved under its tag', async () => {
    const [first] = await repo.sourceArticles(sourceId, DAY);
    await repo.saveArticle(uid, first!.id, ['later']);
    const layout = await composeLayout(
      repo,
      uid,
      DAY,
      uid,
      await editionPick(repo, edition({ tag: 'later' }), DAY),
    );
    expect(storyIds(layout)).toEqual([first!.id]);
  });

  it('prints nothing from feeds outside its sections', async () => {
    const section = await repo.addSection(uid, 'Tech');
    const layout = await composeLayout(
      repo,
      uid,
      DAY,
      uid,
      await editionPick(repo, edition({ section_ids: [section.id] }), DAY),
    );
    expect(storyIds(layout)).toEqual([]);
  });

  it('prints the feeds of the sections nested in its sections', async () => {
    const tech = await repo.addSection(uid, 'Tech');
    const ai = await repo.addSection(uid, 'AI', undefined, tech.id);
    const [feed] = await repo.listFeeds(uid);
    await repo.updateFeed(uid, feed!.id, { section_id: ai.id });
    const layout = await composeLayout(
      repo,
      uid,
      DAY,
      uid,
      await editionPick(repo, edition({ section_ids: [tech.id] }), DAY),
    );
    expect(storyIds(layout)).toHaveLength(2);
  });

  it('prints a feed filed in its section among others', async () => {
    const tech = await repo.addSection(uid, 'Tech');
    const news = await repo.addSection(uid, 'News');
    const [feed] = await repo.listFeeds(uid);
    await repo.updateFeed(uid, feed!.id, { section_ids: [news.id, tech.id] });
    const layout = await composeLayout(
      repo,
      uid,
      DAY,
      uid,
      await editionPick(repo, edition({ section_ids: [tech.id] }), DAY),
    );
    expect(storyIds(layout)).toHaveLength(2);
  });

  it('stores an issue with a note that reads back by edition', async () => {
    await repo.writeEdition(sourceId, DAY, [item(1), item(2), item(3)]);
    const stored = await repo.addCustomEdition(uid, { name: 'Weekend' });
    expect(await publishEditionIssue(db, envWith('Note.'), stored, DAY)).toBe(
      3,
    );
    const issue = await storedEditionIssue(repo, stored.id, DAY);
    expect(issue?.briefing).toBe('Note.');
    expect(await storedIssue(repo, uid, DAY)).toBeUndefined();
  });

  it('lays a day out live when no issue of the edition was stored', async () => {
    const issue = await editionIssueFor(repo, edition({ query: 'story' }), DAY);
    expect(issue.created_at).toBeNull();
    expect(storyIds(issue.layout)).toHaveLength(2);
  });
});

describe('composeLayout and the reader’s own auto-mark-read days', () => {
  const OLD = '2020-01-01';

  beforeEach(async () => {
    await repo.writeEdition(sourceId, OLD, [item(9)]);
  });

  it('leaves out an edition older than the reader’s days', async () => {
    await repo.updatePreferences(uid, { auto_mark_read_days: 7 });
    expect(storyIds(await composeLayout(repo, uid, OLD, uid))).toEqual([]);
  });

  it('lets a feed’s 0 keep every edition', async () => {
    await repo.updatePreferences(uid, { auto_mark_read_days: 7 });
    const [feed] = await repo.listFeeds(uid);
    await repo.updateFeed(uid, feed!.id, { auto_mark_read_days: 0 });
    expect(storyIds(await composeLayout(repo, uid, OLD, uid))).toHaveLength(1);
  });

  it('keeps every edition with the reader’s days at 0', async () => {
    expect(storyIds(await composeLayout(repo, uid, OLD, uid))).toHaveLength(1);
  });

  it('keeps every edition for a paper laid out with no reader', async () => {
    await repo.updatePreferences(uid, { auto_mark_read_days: 7 });
    expect(storyIds(await composeLayout(repo, uid, OLD))).toHaveLength(1);
  });
});

describe('composeLayout and AI prompts', () => {
  it('prints a story a hide prompt matched last for the reader', async () => {
    const { classifier } = await repo.addClassifier(uid, {
      kind: 'prompt',
      value: 'gossip',
      score: -1,
    });
    const [first] = await repo.sourceArticles(sourceId, DAY);
    await repo.savePromptScores(
      uid,
      classifier.id,
      new Map([[first!.id, true]]),
    );
    const ids = storyIds(await composeLayout(repo, uid, DAY, uid));
    expect(ids.at(-1)).toBe(first!.id);
  });
});
