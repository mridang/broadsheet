import { beforeEach, describe, expect, it } from '@jest/globals';

import { databaseFrom, type Database } from '@/domain/db/client';
import { Repository } from '@/domain/repository';
import { ShareRepository } from '@/domain/shares';
import { APP_MIGRATIONS } from '../lib/core/db/migrations';
import { sqliteD1 } from '../lib/core/db/sqlite-d1';

let db: Database;
let articleId: number;

beforeEach(async () => {
  db = databaseFrom(sqliteD1(...APP_MIGRATIONS).d1);
  const repo = new Repository(db);
  await repo.upsertUser({ sub: 'g1', email: 'a@b.com', name: 'A' });
  await repo.upsertUser({ sub: 'g2', email: 'c@d.com' });
  const feed = (await repo.addFeed(1, 'https://a.test/f'))!;
  await repo.writeEdition(feed.source_id, '2026-11-01', [
    {
      url: 'https://a.test/1',
      title: 'One',
      source: 'a.test',
      image: '',
      favicon: '',
      summary: '',
      published_at: '',
      points: 0,
    },
  ]);
  const found = await repo.searchArticles(1, { limit: 1 });
  articleId = found[0]!.id;
});

describe('ShareRepository', () => {
  it('shares a story with the sharer’s name', async () => {
    const { story, created } = await new ShareRepository(db).share(
      1,
      articleId,
      'Good',
    );
    expect([
      created,
      story.comments,
      story.sharer,
      story.article.title,
    ]).toEqual([true, 'Good', { id: 1, name: 'A' }, 'One']);
  });

  it('replaces the comment of an earlier share', async () => {
    const shares = new ShareRepository(db);
    await shares.share(1, articleId, 'First');
    const again = await shares.share(1, articleId, null);
    expect([again.created, again.story.comments]).toEqual([false, null]);
  });

  it('lists shares newest first, everyone’s or chosen people’s', async () => {
    const shares = new ShareRepository(db);
    await shares.share(1, articleId, null);
    await shares.share(2, articleId, null);
    const everyone = await shares.list({ limit: 10 });
    const onlyTwo = await shares.list({ userIds: [2], limit: 10 });
    expect([
      everyone.map((s) => s.sharer.id),
      onlyTwo.map((s) => s.sharer.id),
    ]).toEqual([[2, 1], [2]]);
  });

  it('pages with before, asking for one more than the limit', async () => {
    const shares = new ShareRepository(db);
    await shares.share(1, articleId, null);
    const second = await shares.share(2, articleId, null);
    const firstPage = await shares.list({ limit: 1 });
    const older = await shares.list({ before: second.story.id, limit: 5 });
    expect([firstPage.length, older.length]).toEqual([2, 1]);
  });

  it('unshares, once', async () => {
    const shares = new ShareRepository(db);
    await shares.share(1, articleId, null);
    expect([
      await shares.unshare(1, articleId),
      await shares.unshare(1, articleId),
    ]).toEqual([true, false]);
  });
});
