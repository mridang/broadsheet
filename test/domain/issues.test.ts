import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { databaseFrom, type Database } from '@/domain/db/database';
import {
  briefingPrompt,
  composeLayout,
  isIssueDate,
  issueFor,
  publishIssue,
  storedIssue,
  writeBriefing,
} from '@/domain/issues';
import { storyIds } from '@/domain/render/layout';
import { Repository, type Article } from '@/domain/repository';
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

describe('composeLayout', () => {
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
});

describe('briefingPrompt', () => {
  it('lists each story with the start of its summary', () => {
    const prompt = briefingPrompt([
      { title: 'One', summary: 'About one' } as Article,
      { title: 'Two', summary: '' } as Article,
    ]);
    expect(prompt).toContain('- One: About one');
    expect(prompt).toContain('- Two\n'.trimEnd());
  });
});

describe('writeBriefing', () => {
  it('returns the model’s note, trimmed', async () => {
    expect(await writeBriefing(envWith('  A big day. '), [{} as Article])).toBe(
      'A big day.',
    );
  });

  it('asks nothing when there are no stories', async () => {
    const env = envWith('x');
    expect(await writeBriefing(env, [])).toBeNull();
    expect(env.AI.run).not.toHaveBeenCalled();
  });

  it('gives no note when the model answers with nothing', async () => {
    expect(await writeBriefing(envWith(''), [{} as Article])).toBeNull();
  });

  it('logs a model failure and gives no note', async () => {
    const error = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    expect(
      await writeBriefing(envWith(new Error('down')), [{} as Article]),
    ).toBeNull();
    expect(String(error.mock.calls[0]?.[0])).toContain('briefing.failed');
    error.mockRestore();
  });
});

describe('publishIssue', () => {
  it('stores the layout and the note for the day', async () => {
    expect(await publishIssue(db, envWith('Note.'), uid, DAY)).toBe(2);
    const issue = await storedIssue(repo, uid, DAY);
    expect(issue?.briefing).toBe('Note.');
    expect(storyIds(issue!.layout)).toHaveLength(2);
  });

  it('replaces the day’s issue when run again', async () => {
    await publishIssue(db, envWith('First.'), uid, DAY);
    await publishIssue(db, envWith('Second.'), uid, DAY);
    expect((await storedIssue(repo, uid, DAY))?.briefing).toBe('Second.');
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
