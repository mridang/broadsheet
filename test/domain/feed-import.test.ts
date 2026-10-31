import { beforeEach, describe, expect, it } from '@jest/globals';

import { databaseFrom } from '@/domain/db/database';
import { importFeeds } from '@/domain/feed-import';
import { Repository } from '@/domain/repository';
import { APP_MIGRATIONS } from '../lib/core/db/migrations';
import { sqliteD1 } from '../lib/core/db/sqlite-d1';

let repo: Repository;

beforeEach(() => {
  repo = new Repository(databaseFrom(sqliteD1(...APP_MIGRATIONS).d1));
});

describe('importFeeds', () => {
  it('follows new feeds, filing them under sections it creates or reuses', async () => {
    await repo.addSection(1, 'tech');
    const summary = await importFeeds(repo, 1, [
      { url: 'https://a.test/1', title: 'One', section: 'Tech' },
      { url: 'https://a.test/2', section: 'News' },
      { url: 'https://a.test/3', section: 'News' },
    ]);
    expect(summary).toMatchObject({
      added: 3,
      skipped: 0,
      sections_added: 1,
      rejected: [],
    });
    expect((await repo.listSections(1)).map((s) => s.name)).toEqual([
      'tech',
      'News',
    ]);
    expect((await repo.listFeeds(1)).map((f) => f.section_id)).toEqual([
      1, 2, 2,
    ]);
  });

  it('skips feeds already followed and rejects invalid ones', async () => {
    await repo.addFeed(1, 'https://a.test/1');
    const summary = await importFeeds(repo, 1, [
      { url: 'https://a.test/1', section: 'Ignored' },
      { url: 'ftp://a.test/2' },
      { url: 'nonsense' },
    ]);
    expect(summary).toMatchObject({ added: 0, skipped: 1, sections_added: 0 });
    expect(summary.rejected.map((r) => r.url)).toEqual([
      'ftp://a.test/2',
      'nonsense',
    ]);
    expect(await repo.listSections(1)).toEqual([]);
  });
});
