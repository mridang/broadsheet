import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { createDatabase, type Database } from '@/domain/db/client';
import { ToolFailureError } from '@/domain/mcp/tool-failure';
import { callTool } from '@/domain/mcp/tool-calls';
import type { ToolContext } from '@/domain/mcp/tool-context';
import type { ToolServices } from '@/domain/mcp/tool-services';
import type { User } from '@/domain/db/users';
import type { AnswerModel } from '@/domain/assistant';
import { Repository } from '@/domain/repository';
import type { ScrapedItem } from '@/lib/scraping';
import { APP_MIGRATIONS } from '../../../lib/core/db/migrations';
import { sqliteD1 } from '../../../lib/core/db/sqlite-d1';

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

describe('get_infrequent_stories', () => {
  it('lists stories from feeds under the monthly limit', async () => {
    await seed();
    const busy = (await new Repository(db).addFeed(1, 'https://b.test/feed'))!;
    const today = new Date().toISOString().slice(0, 10);
    await new Repository(db).writeEdition(
      busy.source_id,
      today,
      Array.from({ length: 5 }, (_, index) =>
        item(`https://b.test/${index}`, `B${index}`),
      ),
    );
    const found = (await run('get_infrequent_stories', {
      stories_per_month: 3,
    })) as { feed_ids: string[]; articles: unknown[] };
    expect(found.feed_ids).not.toContain(String(busy.id));
  });

  it('returns nothing when every feed is busy', async () => {
    const repo = new Repository(db);
    const busy = (await repo.addFeed(1, 'https://b.test/feed'))!;
    await repo.writeEdition(
      busy.source_id,
      new Date().toISOString().slice(0, 10),
      [item('https://b.test/1', 'B1'), item('https://b.test/2', 'B2')],
    );
    expect(
      await run('get_infrequent_stories', { stories_per_month: 1 }),
    ).toEqual({ feed_ids: [], articles: [] });
  });
});
