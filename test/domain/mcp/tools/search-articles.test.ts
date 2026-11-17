import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { z } from 'zod';
import { TOOL_REGISTRY } from '@/domain/mcp/tools';
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

/** The stories a search answers with, and where its next page starts. */
const ARTICLES = z.looseObject({
  articles: z.array(z.looseObject({ title: z.string() })),
});
const PAGE = ARTICLES.extend({ next_before: z.number().optional() });

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

/** Every tool, as the zod-backed class it is, so a test can read its schema. */
const ZOD_TOOLS = TOOL_REGISTRY.all;

/** The tool with this name, as the zod-backed class it is. */
const zodTool = (name: string) => ZOD_TOOLS.find((tool) => tool.name === name)!;

describe('search_articles', () => {
  it('finds stories by their words', async () => {
    await seed();
    expect(await run('search_articles', { query: 'Rust' })).toEqual({
      articles: [expect.objectContaining({ title: 'Rust ships' })],
    });
  });

  it('pages with next_before', async () => {
    await seed();
    const first = PAGE.parse(
      await run('search_articles', { query: '', limit: 1 }),
    );
    expect(first.next_before).toEqual(expect.any(Number));
  });

  it('narrows to one feed', async () => {
    const { feedId } = await seed();
    const other = (await new Repository(db).addFeed(1, 'https://b.test/feed'))!;
    await new Repository(db).writeEdition(other.source_id, '2026-11-01', [
      item('https://b.test/1', 'Rust elsewhere'),
    ]);
    const found = ARTICLES.parse(
      await run('search_articles', {
        query: 'Rust',
        feed_id: feedId,
      }),
    );
    expect(found.articles.map((a) => a.title)).toEqual(['Rust ships']);
  });

  it("finds nothing in another person's feed", async () => {
    await seed();
    const other = (await new Repository(db).addFeed(2, 'https://o.test/f'))!;
    await expect(
      run('search_articles', { query: 'Rust', feed_id: other.id }),
    ).rejects.toThrow('There is no such feed.');
  });

  it('finds nothing from feeds others follow', async () => {
    await seed();
    ctx = asCaller(2);
    expect(await run('search_articles', { query: 'Rust' })).toEqual({
      articles: [],
    });
  });
});

describe('search_articles by read state', () => {
  it.each([
    ['unread', ['Go ships']],
    ['read', ['Rust ships']],
  ])('keeps only %s stories', async (readFilter, titles) => {
    const { articleId } = await seed();
    await new Repository(db).markRead(1, articleId);
    const found = ARTICLES.parse(
      await run('search_articles', {
        query: '',
        read_filter: readFilter,
      }),
    );
    expect(found.articles.map((a) => a.title)).toEqual(titles);
  });
});

describe('search_articles filters', () => {
  /** A second feed with an older edition from another site. */
  async function second() {
    const repo = new Repository(db);
    const feed = (await repo.addFeed(1, 'https://b.test/feed'))!;
    await repo.writeEdition(feed.source_id, '2026-10-01', [
      item('https://news.b.test/x', 'Zig ships'),
    ]);
    return feed;
  }

  const titles = async (args: Record<string, unknown>) =>
    ARTICLES.parse(await run('search_articles', args)).articles.map(
      (a) => a.title,
    );

  it('narrows to several feeds', async () => {
    const { feedId } = await seed();
    const other = await second();
    expect(await titles({ feed_ids: [other.id] })).toEqual(['Zig ships']);
    expect(await titles({ feed_ids: [feedId, other.id] })).toHaveLength(3);
  });

  it('narrows to a section and its subsections', async () => {
    await seed();
    const other = await second();
    const repo = new Repository(db);
    const top = await repo.addSection(1, 'Top');
    const inner = await repo.addSection(1, 'Inner', undefined, top.id);
    await repo.updateFeed(1, other.id, { section_id: inner.id });
    expect(await titles({ section_id: top.id })).toEqual(['Zig ships']);
  });

  it("refuses another person's section", async () => {
    const theirs = await new Repository(db).addSection(2, 'Theirs');
    await expect(
      run('search_articles', { section_id: theirs.id }),
    ).rejects.toThrow('There is no such section.');
  });

  it('narrows to a site and the sites under it', async () => {
    await seed();
    await second();
    expect(await titles({ domain: 'b.test' })).toEqual(['Zig ships']);
  });

  it('refuses a domain with other characters', async () => {
    const found = zodTool('search_articles');
    expect(found.input.safeParse({ domain: "x' or 1" }).success).toBe(false);
  });

  it('narrows to a range of editions', async () => {
    await seed();
    await second();
    expect(await titles({ date_to: '2026-10-15' })).toEqual(['Zig ships']);
    expect(await titles({ date_from: '2026-10-15' })).toHaveLength(2);
  });

  it('refuses a day that is not on the calendar', () => {
    const found = zodTool('search_articles');
    expect(found.input.safeParse({ date_from: '2026-02-31' }).success).toBe(
      false,
    );
  });

  it('lists oldest first', async () => {
    await seed();
    expect(await titles({ order: 'oldest' })).toEqual([
      'Rust ships',
      'Go ships',
    ]);
  });

  it('leaves out disliked stories unless asked for them', async () => {
    await seed();
    await new Repository(db).addClassifier(1, {
      kind: 'title',
      value: 'Go',
      score: -1,
    });
    expect(await titles({})).toEqual(['Rust ships']);
    expect(await titles({ include_hidden: true })).toHaveLength(2);
  });

  it('fills a page past filtered stories and says where to continue', async () => {
    const { articleId } = await seed();
    await new Repository(db).markRead(1, articleId + 1);
    const page = PAGE.parse(
      await run('search_articles', {
        read_filter: 'unread',
        limit: 1,
      }),
    );
    expect(page).toEqual({
      articles: [expect.objectContaining({ title: 'Rust ships' })],
    });
  });
});
