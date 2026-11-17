import { beforeEach, describe, expect, it, jest } from '@jest/globals';

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

describe('mark_read', () => {
  it('marks stories by id and counts what happened', async () => {
    const { articleId } = await seed();
    await new Repository(db).markRead(1, articleId);
    expect(
      await run('mark_read', { article_ids: [articleId, articleId + 1, 999] }),
    ).toEqual({ marked: 1, already_read: 1, not_found: 1 });
  });

  it('marks every story of a feed', async () => {
    const { feedId } = await seed();
    expect(await run('mark_read', { feed_id: feedId })).toMatchObject({
      marked: 2,
    });
  });

  it('needs ids, a feed, a section or an age', async () => {
    await expect(run('mark_read')).rejects.toThrow(
      'Send article_ids, feed_id, section_id or older_than_days.',
    );
  });

  it("refuses another person's feed", async () => {
    const other = (await new Repository(db).addFeed(2, 'https://o.test/f'))!;
    await expect(run('mark_read', { feed_id: other.id })).rejects.toThrow(
      'There is no such feed.',
    );
  });
});

describe('mark_read more ways', () => {
  it('marks every story of a section', async () => {
    const { feedId } = await seed();
    const repo = new Repository(db);
    const section = await repo.addSection(1, 'Tech');
    await repo.updateFeed(1, feedId, { section_id: section.id });
    expect(await run('mark_read', { section_id: section.id })).toMatchObject({
      marked: 2,
    });
  });

  it('marks only stories older than some days', async () => {
    await seed();
    const repo = new Repository(db);
    const old = (await repo.addFeed(1, 'https://b.test/feed'))!;
    await repo.writeEdition(old.source_id, '2020-01-01', [
      item('https://b.test/old', 'Old'),
    ]);
    expect(await run('mark_read', { older_than_days: 365 })).toMatchObject({
      marked: 1,
    });
  });

  it('marks a story unread again', async () => {
    const { articleId } = await seed();
    await new Repository(db).markRead(1, articleId);
    expect(await run('mark_unread', { article_id: articleId })).toEqual({
      unread: true,
    });
  });

  it('refuses to mark unread a story not read', async () => {
    await expect(run('mark_unread', { article_id: 1 })).rejects.toThrow(
      'That story is not marked read.',
    );
  });
});
