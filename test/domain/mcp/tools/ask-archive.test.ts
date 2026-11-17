import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { DAILY_LIMITS } from '@/domain/assistant';
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

describe('ask_archive', () => {
  const answering = (response: unknown) => ({
    run: async () => ({ response }),
  });

  it('answers in a new conversation and keeps both turns', async () => {
    await seed();
    ctx = asCaller(1, answering('Rust shipped.'));
    const result = (await run('ask_archive', {
      question: 'What shipped?',
    })) as {
      conversation_id: string;
      message: { content: string };
    };
    const messages = await new Repository(db).listMessages(
      Number(result.conversation_id),
    );
    expect([result.message.content, messages.length]).toEqual([
      'Rust shipped.',
      2,
    ]);
  });

  it("refuses another person's conversation", async () => {
    const theirs = await new Repository(db).addConversation(2);
    ctx = asCaller(1, answering('x'));
    await expect(
      run('ask_archive', { question: 'Hi', conversation_id: theirs.id }),
    ).rejects.toThrow('There is no such conversation.');
  });

  it('refuses once today’s assistant budget is used up', async () => {
    const repo = new Repository(db);
    for (let index = 0; index < DAILY_LIMITS.assistant; index++) {
      await repo.recordUsage(ctx.user.id, 'assistant');
    }
    ctx = asCaller(1, answering('x'));
    await expect(run('ask_archive', { question: 'Hi' })).rejects.toThrow(
      'You have used all your assistant questions for today.',
    );
  });

  it('says so when no model is bound', async () => {
    await expect(run('ask_archive', { question: 'Hi' })).rejects.toThrow(
      'The assistant could not answer just now.',
    );
  });

  it('refuses a blank question', async () => {
    await expect(run('ask_archive', { question: ' ' })).rejects.toThrow(
      'question: must not be blank.',
    );
  });
});
