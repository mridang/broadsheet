import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { z } from 'zod';

import { createDatabase } from '@/domain/db/client';
import { ToolFailureError } from '@/domain/mcp/tool-failure';
import { callTool } from '@/domain/mcp/tool-calls';
import { Repository } from '@/domain/repository';
import { APP_MIGRATIONS } from '../../../lib/core/db/migrations';
import { sqliteD1 } from '../../../lib/core/db/sqlite-d1';
import { fixtureUser } from '../../fixtures';
import type { Database } from '@/domain/db/client';
import type { ToolContext } from '@/domain/mcp/tool-context';
import type { ToolServices } from '@/domain/mcp/tool-services';
import type { AnswerModel } from '@/domain/assistant';
import type { ScrapedItem } from '@/lib/scraping';

let db: Database;
let ctx: ToolContext;
let refresh: jest.Mock<ToolServices['refresh']>;

/** The context of a call by this person, with this model bound when there is one. */
const asCaller = (uid: number, model?: AnswerModel): ToolContext => ({
  user: fixtureUser({ id: uid }),
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

describe('sharing', () => {
  it('shares with a comment, without the sharer’s email', async () => {
    const { articleId } = await seed();
    const result = z
      .looseObject({
        share: z.record(z.string(), z.unknown()),
        created: z.boolean(),
      })
      .parse(
        await run('share_story', {
          article_id: articleId,
          comments: 'Worth it',
        }),
      );
    expect(JSON.stringify(result)).not.toContain('a@b.com');
    expect(result).toMatchObject({
      created: true,
      share: { comments: 'Worth it', article: { title: 'Rust ships' } },
    });
  });

  it('refuses an article the caller cannot see', async () => {
    const { articleId } = await seed();
    ctx = asCaller(2);
    await expect(run('share_story', { article_id: articleId })).rejects.toThrow(
      'There is no such article.',
    );
  });

  it('lists everyone’s shares, or chosen people’s', async () => {
    const { articleId } = await seed();
    await run('share_story', { article_id: articleId });
    ctx = asCaller(2);
    expect(await run('get_shared_stories')).toMatchObject({
      shares: [{ sharer: { id: '1' } }],
    });
    expect(await run('get_shared_stories', { sharer_ids: [2] })).toEqual({
      shares: [],
    });
  });

  it('leaves out shared stories the caller read when asked for unread', async () => {
    const { articleId } = await seed();
    await run('share_story', { article_id: articleId });
    await new Repository(db).markRead(1, articleId);
    expect(await run('get_shared_stories', { read_filter: 'unread' })).toEqual({
      shares: [],
    });
  });

  it('unshares', async () => {
    const { articleId } = await seed();
    await run('share_story', { article_id: articleId });
    expect(await run('unshare_story', { article_id: articleId })).toEqual({
      removed: true,
    });
  });

  it('refuses to unshare what is not shared', async () => {
    await expect(run('unshare_story', { article_id: 1 })).rejects.toThrow(
      'That story is not shared.',
    );
  });
});
