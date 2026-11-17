import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { createDatabase } from '@/domain/db/client';
import { ToolFailureError } from '@/domain/mcp/tool-failure';
import { callTool } from '@/domain/mcp/tool-calls';
import { Repository } from '@/domain/repository';
import { APP_MIGRATIONS } from '../../../lib/core/db/migrations';
import { sqliteD1 } from '../../../lib/core/db/sqlite-d1';
import type { Database } from '@/domain/db/client';
import type { ToolContext } from '@/domain/mcp/tool-context';
import type { ToolServices } from '@/domain/mcp/tool-services';
import type { User } from '@/domain/db/users';
import type { AnswerModel } from '@/domain/assistant';
import type { ScrapedItem } from '@/lib/scraping';

let db: Database;
let ctx: ToolContext;
let refresh: jest.Mock<ToolServices['refresh']>;

/** The context of a call by this person, with this model bound when there is one. */
const asCaller = (uid: number, model?: AnswerModel): ToolContext => ({
  user: { id: uid } as User,
  services: { openDatabase: () => db, refresh, ...(model && { model }) },
});

/** A scraped story. */
const item = (url: string, title: string): ScrapedItem => ({
  url,
  title,
  source: 'a.test',
  image: '',
  favicon: '',
  summary: `${title} summary`,
  published_at: '2026-11-01T08:00:00Z',
  points: 1,
  body_text: `${title} body`,
});

beforeEach(async () => {
  db = createDatabase(sqliteD1(...APP_MIGRATIONS).d1);
  const repo = new Repository(db);
  await repo.upsertUser({ sub: 'g1', email: 'a@b.com' });
  await repo.upsertUser({ sub: 'g2', email: 'c@d.com' });
  refresh = jest.fn<ToolServices['refresh']>();
  ctx = asCaller(1);
});

/** Run a tool by name with arguments parsed as `tools/call` would. */
async function run(name: string, args: Record<string, unknown> = {}) {
  const result = await callTool(
    ctx.user,
    { name, arguments: args },
    ctx.services,
  );
  if (result.isError) {
    throw new ToolFailureError(result.content[0]?.text ?? '');
  }
  return result.structuredContent;
}

/** Follow a feed for person 1 with one edition of stories. */
async function seed(): Promise<{ feedId: number; articleId: number }> {
  const repo = new Repository(db);
  const feed = (await repo.addFeed(1, 'https://a.test/feed'))!;
  await repo.writeEdition(feed.source_id, '2026-11-01', [
    item('https://a.test/1', 'Rust ships'),
    item('https://a.test/2', 'Go ships'),
  ]);
  const [article] = await repo.searchArticles(1, { q: 'Rust', limit: 1 });
  return { feedId: feed.id, articleId: article!.id };
}

describe('train_classifier', () => {
  it('trains many kinds at once, and the feed itself', async () => {
    const { feedId } = await seed();
    const { classifiers } = (await run('train_classifier', {
      feed_id: feedId,
      like_title: ['rust'],
      super_dislike_text: ['crypto'],
      dislike_feed: true,
    })) as { classifiers: { kind: string; score: string }[] };
    expect(classifiers.map((c) => [c.kind, c.score])).toEqual([
      ['title', 'like'],
      ['text', 'super_dislike'],
      ['feed', 'dislike'],
    ]);
  });

  it('lists the training of one feed', async () => {
    const { feedId } = await seed();
    await run('train_classifier', { feed_id: feedId, like_feed: true });
    await run('add_classifier', { kind: 'title', value: 'x', score: 'like' });
    expect(await run('list_classifiers', { feed_id: feedId })).toMatchObject({
      classifiers: [{ kind: 'feed' }],
    });
  });

  it('needs something to train', async () => {
    const { feedId } = await seed();
    await expect(run('train_classifier', { feed_id: feedId })).rejects.toThrow(
      'Send something to train.',
    );
  });

  it('refuses to like and dislike the feed at once', async () => {
    const { feedId } = await seed();
    await expect(
      run('train_classifier', {
        feed_id: feedId,
        like_feed: true,
        dislike_feed: true,
      }),
    ).rejects.toThrow('Like or dislike the feed, not both.');
  });

  it("refuses another person's feed", async () => {
    const other = (await new Repository(db).addFeed(2, 'https://o.test/f'))!;
    await expect(
      run('train_classifier', { feed_id: other.id, like_title: ['x'] }),
    ).rejects.toThrow('There is no such feed.');
  });

  it('refuses a blank value', async () => {
    const { feedId } = await seed();
    await expect(
      run('train_classifier', { feed_id: feedId, like_title: [' '] }),
    ).rejects.toThrow('value: must be a non-blank string.');
  });
});
