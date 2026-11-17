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

describe('list_feeds', () => {
  it('lists the feeds and sections of the caller only', async () => {
    await seed();
    await new Repository(db).addSection(1, 'Tech');
    await new Repository(db).addFeed(2, 'https://other.test/feed');
    expect(await run('list_feeds')).toMatchObject({
      feeds: [{ url: 'https://a.test/feed' }],
      sections: [{ name: 'Tech' }],
    });
  });
});

describe('list_feeds without headers', () => {
  it('leaves each feed header for get_feed', async () => {
    await seed();
    const { feeds } = z
      .looseObject({ feeds: z.array(z.looseObject({})) })
      .parse(await run('list_feeds'));
    expect(feeds[0]).not.toHaveProperty('metadata');
  });
});

describe('list_feeds with counts', () => {
  it('counts unread and monthly stories per feed and section', async () => {
    const { feedId, articleId } = await seed();
    const repo = new Repository(db);
    const section = await repo.addSection(1, 'Tech');
    await repo.updateFeed(1, feedId, { section_id: section.id });
    await repo.markRead(1, articleId);
    expect(await run('list_feeds', { include_counts: true })).toMatchObject({
      feeds: [{ unread: 1, stories_per_month: expect.any(Number) }],
      sections: [{ feed_ids: [String(feedId)], unread: 1 }],
    });
  });
});
