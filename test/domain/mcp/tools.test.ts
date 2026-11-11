import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { DAILY_LIMITS } from '@/domain/assistant';
import { databaseFrom, type Database } from '@/domain/db/database';
import { collect, TOOLS, type ToolContext } from '@/domain/mcp/tools';
import { Repository } from '@/domain/repository';
import type { ScrapedItem } from '@/lib/scraping';
import { APP_MIGRATIONS } from '../../lib/core/db/migrations';
import { sqliteD1 } from '../../lib/core/db/sqlite-d1';

let db: Database;
let ctx: ToolContext;
let refresh: jest.Mock<ToolContext['refresh']>;

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
  db = databaseFrom(sqliteD1(...APP_MIGRATIONS).d1);
  const repo = new Repository(db);
  await repo.upsertUser({ sub: 'g1', email: 'a@b.com' });
  await repo.upsertUser({ sub: 'g2', email: 'c@d.com' });
  refresh = jest.fn<ToolContext['refresh']>();
  ctx = { uid: 1, db, refresh };
});

/** Run a tool by name with arguments parsed as `tools/call` would. */
async function run(name: string, args: Record<string, unknown> = {}) {
  const found = TOOLS.find((t) => t.name === name)!;
  return found.run(found.input.parse(args), ctx);
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
    const { feeds } = (await run('list_feeds')) as { feeds: object[] };
    expect(feeds[0]).not.toHaveProperty('metadata');
  });
});

describe('get_feed', () => {
  it('returns the feed with its header and statistics', async () => {
    const { feedId } = await seed();
    expect(await run('get_feed', { feed_id: feedId })).toMatchObject({
      feed: { url: 'https://a.test/feed', metadata: [] },
      statistics: { fail_count: 0 },
    });
  });

  it("refuses another person's feed", async () => {
    const other = (await new Repository(db).addFeed(2, 'https://o.test/f'))!;
    await expect(run('get_feed', { feed_id: other.id })).rejects.toThrow(
      'There is no such feed.',
    );
  });
});

describe('follow_feed', () => {
  it('follows a new feed and fetches it', async () => {
    expect(
      await run('follow_feed', { url: 'https://n.test/rss' }),
    ).toMatchObject({ created: true, feed: { url: 'https://n.test/rss' } });
    expect(refresh).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'https://n.test/rss' }),
    );
  });

  it('returns a feed already followed unchanged', async () => {
    await run('follow_feed', { url: 'https://n.test/rss' });
    expect(
      await run('follow_feed', { url: 'https://n.test/rss' }),
    ).toMatchObject({ created: false });
  });

  it('refuses an address that is not http', async () => {
    // eslint-disable-next-line sonarjs/no-clear-text-protocols -- test fixture
    await expect(run('follow_feed', { url: 'ftp://x' })).rejects.toThrow(
      'url: must be an http or https address.',
    );
  });
});

describe('unfollow_feed', () => {
  it('stops following a feed', async () => {
    const { feedId } = await seed();
    expect(await run('unfollow_feed', { feed_id: feedId })).toEqual({
      removed: true,
    });
  });

  it("refuses another person's feed", async () => {
    const other = (await new Repository(db).addFeed(2, 'https://o.test/f'))!;
    await expect(run('unfollow_feed', { feed_id: other.id })).rejects.toThrow(
      'There is no such feed.',
    );
  });
});

describe('read_paper', () => {
  it('prints the latest edition by feed', async () => {
    await seed();
    expect(await run('read_paper')).toMatchObject({
      edition: '2026-11-01',
      desks: [{ feed: 'https://a.test/feed', stories: [{}, {}] }],
    });
  });

  it('names a nested section after the sections it is in', async () => {
    const { feedId } = await seed();
    const repo = new Repository(db);
    const tech = await repo.addSection(1, 'Tech');
    const ai = await repo.addSection(1, 'AI', undefined, tech.id);
    await repo.updateFeed(1, feedId, { section_id: ai.id });
    expect(await run('read_paper')).toMatchObject({
      desks: [{ section: 'Tech · AI' }],
    });
  });

  it('leaves out disliked and read stories', async () => {
    const { articleId } = await seed();
    const repo = new Repository(db);
    await repo.addClassifier(1, { kind: 'title', value: 'Go', score: -1 });
    await repo.markRead(1, articleId);
    expect(await run('read_paper')).toMatchObject({ desks: [] });
  });
});

describe('search_articles', () => {
  it('finds stories by their words', async () => {
    await seed();
    expect(await run('search_articles', { query: 'Rust' })).toEqual({
      articles: [expect.objectContaining({ title: 'Rust ships' })],
    });
  });

  it('pages with next_before', async () => {
    await seed();
    const first = (await run('search_articles', { query: '', limit: 1 })) as {
      next_before?: number;
    };
    expect(first.next_before).toEqual(expect.any(Number));
  });

  it('narrows to one feed', async () => {
    const { feedId } = await seed();
    const other = (await new Repository(db).addFeed(1, 'https://b.test/feed'))!;
    await new Repository(db).writeEdition(other.source_id, '2026-11-01', [
      item('https://b.test/1', 'Rust elsewhere'),
    ]);
    const found = (await run('search_articles', {
      query: 'Rust',
      feed_id: feedId,
    })) as { articles: { title: string }[] };
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
    ctx = { ...ctx, uid: 2 };
    expect(await run('search_articles', { query: 'Rust' })).toEqual({
      articles: [],
    });
  });
});

describe('get_article', () => {
  it('returns the article with its text', async () => {
    const { articleId } = await seed();
    expect(await run('get_article', { article_id: articleId })).toMatchObject({
      title: 'Rust ships',
      body_text: 'Rust ships body',
    });
  });

  it('refuses an article from a feed the caller does not follow', async () => {
    const { articleId } = await seed();
    ctx = { ...ctx, uid: 2 };
    await expect(run('get_article', { article_id: articleId })).rejects.toThrow(
      'There is no such article.',
    );
  });
});

describe('save_article and unsave_article', () => {
  it('saves with tags', async () => {
    const { articleId } = await seed();
    expect(
      await run('save_article', { article_id: articleId, tags: ['rust'] }),
    ).toMatchObject({ created: true, save: { tags: ['rust'] } });
  });

  it('refuses blank tags', async () => {
    const { articleId } = await seed();
    await expect(
      run('save_article', { article_id: articleId, tags: [' '] }),
    ).rejects.toThrow('tags:');
  });

  it('refuses an unknown article', async () => {
    await expect(run('save_article', { article_id: 999 })).rejects.toThrow(
      'There is no such article.',
    );
  });

  it('unsaves', async () => {
    const { articleId } = await seed();
    await run('save_article', { article_id: articleId });
    expect(await run('unsave_article', { article_id: articleId })).toEqual({
      removed: true,
    });
  });

  it('refuses to unsave what is not saved', async () => {
    await expect(run('unsave_article', { article_id: 1 })).rejects.toThrow(
      'That article is not saved.',
    );
  });
});

describe('classifiers', () => {
  it('adds a like and lists it', async () => {
    await run('add_classifier', {
      kind: 'source',
      value: 'a.test',
      score: 'like',
    });
    expect(await run('list_classifiers')).toMatchObject({
      classifiers: [{ kind: 'source', value: 'a.test', score: 'like' }],
    });
  });

  it('refuses a blank value', async () => {
    await expect(
      run('add_classifier', { kind: 'title', value: ' ', score: 'like' }),
    ).rejects.toThrow('value: must be a non-blank string.');
  });

  it('refuses a feed classifier on a feed the person does not follow', async () => {
    await expect(
      run('add_classifier', { kind: 'feed', value: '999', score: 'like' }),
    ).rejects.toThrow('value: no such feed.');
  });

  it('adds a super dislike', async () => {
    expect(
      await run('add_classifier', {
        kind: 'text',
        value: 'sponsored',
        score: 'super_dislike',
      }),
    ).toMatchObject({ classifier: { score: 'super_dislike' } });
  });

  it('removes one', async () => {
    const { classifier } = (await run('add_classifier', {
      kind: 'title',
      value: 'Go',
      score: 'dislike',
    })) as { classifier: { id: string } };
    expect(
      await run('remove_classifier', { classifier_id: Number(classifier.id) }),
    ).toEqual({ removed: true });
  });

  it('refuses to remove an unknown one', async () => {
    await expect(
      run('remove_classifier', { classifier_id: 999 }),
    ).rejects.toThrow('There is no such classifier.');
  });
});

describe('TOOLS', () => {
  it('describes every input in plain words', () => {
    for (const t of TOOLS) {
      for (const field of Object.values(t.input.shape)) {
        expect((field as { description?: string }).description).toBeTruthy();
      }
    }
  });
});

describe('follow_feed into a section', () => {
  it('files the new feed', async () => {
    const section = await new Repository(db).addSection(1, 'Tech');
    expect(
      await run('follow_feed', {
        url: 'https://n.test/rss',
        section_id: section.id,
      }),
    ).toMatchObject({ feed: { section_id: String(section.id) } });
  });

  it("refuses another person's section", async () => {
    const section = await new Repository(db).addSection(2, 'Theirs');
    await expect(
      run('follow_feed', { url: 'https://n.test/rss', section_id: section.id }),
    ).rejects.toThrow('There is no such section.');
  });
});

describe('search_articles by read state', () => {
  it.each([
    ['unread', ['Go ships']],
    ['read', ['Rust ships']],
  ])('keeps only %s stories', async (readFilter, titles) => {
    const { articleId } = await seed();
    await new Repository(db).markRead(1, articleId);
    const found = (await run('search_articles', {
      query: '',
      read_filter: readFilter,
    })) as {
      articles: { title: string }[];
    };
    expect(found.articles.map((a) => a.title)).toEqual(titles);
  });
});

describe('get_account', () => {
  it('names the person with their counts', async () => {
    await seed();
    expect(await run('get_account')).toEqual({
      email: 'a@b.com',
      feeds: 1,
      sections: 0,
      saved: 0,
      classifiers: 0,
    });
  });
});

describe('organize_feed', () => {
  it('renames, mutes and files a feed', async () => {
    const { feedId } = await seed();
    const section = await new Repository(db).addSection(1, 'Tech');
    expect(
      await run('organize_feed', {
        feed_id: feedId,
        title: 'Mine',
        muted: true,
        section_id: section.id,
      }),
    ).toMatchObject({
      feed: { title: 'Mine', muted: true, section_id: String(section.id) },
    });
  });

  it('takes a feed out of its section', async () => {
    const { feedId } = await seed();
    const section = await new Repository(db).addSection(1, 'Tech');
    await run('organize_feed', { feed_id: feedId, section_id: section.id });
    const { feed } = (await run('organize_feed', {
      feed_id: feedId,
      section_id: null,
    })) as { feed: object };
    expect(feed).not.toHaveProperty('section_id');
  });

  it("refuses another person's feed", async () => {
    const other = (await new Repository(db).addFeed(2, 'https://o.test/f'))!;
    await expect(
      run('organize_feed', { feed_id: other.id, muted: true }),
    ).rejects.toThrow('There is no such feed.');
  });

  it("refuses another person's section", async () => {
    const { feedId } = await seed();
    const section = await new Repository(db).addSection(2, 'Theirs');
    await expect(
      run('organize_feed', { feed_id: feedId, section_id: section.id }),
    ).rejects.toThrow('There is no such section.');
  });

  it('refuses a title that is too long', async () => {
    const { feedId } = await seed();
    await expect(
      run('organize_feed', { feed_id: feedId, title: 'x'.repeat(201) }),
    ).rejects.toThrow('title: too long.');
  });
});

describe('sections', () => {
  it('adds one', async () => {
    expect(await run('add_section', { name: 'Tech' })).toMatchObject({
      section: { name: 'Tech' },
    });
  });

  it('refuses a blank name', async () => {
    await expect(run('add_section', { name: ' ' })).rejects.toThrow(
      'name: must be a non-blank string.',
    );
  });

  it('renames one', async () => {
    const section = await new Repository(db).addSection(1, 'Tech');
    expect(
      await run('update_section', { section_id: section.id, name: 'Science' }),
    ).toMatchObject({ section: { name: 'Science' } });
  });

  it("refuses to rename another person's", async () => {
    const section = await new Repository(db).addSection(2, 'Theirs');
    await expect(
      run('update_section', { section_id: section.id, name: 'Mine' }),
    ).rejects.toThrow('There is no such section.');
  });

  it('removes one', async () => {
    const section = await new Repository(db).addSection(1, 'Tech');
    expect(await run('remove_section', { section_id: section.id })).toEqual({
      removed: true,
    });
  });

  it("refuses to remove another person's", async () => {
    const section = await new Repository(db).addSection(2, 'Theirs');
    await expect(
      run('remove_section', { section_id: section.id }),
    ).rejects.toThrow('There is no such section.');
  });
});

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

describe('list_saved', () => {
  it('lists saves with every tag in use', async () => {
    const { articleId } = await seed();
    const repo = new Repository(db);
    await repo.saveArticle(1, articleId, ['rust']);
    await repo.saveArticle(1, articleId + 1, ['go']);
    expect(await run('list_saved', { tag: 'rust' })).toMatchObject({
      saves: [{ tags: ['rust'] }],
      tags: ['go', 'rust'],
    });
  });

  it('searches saves by a tag: term, with every tag in use', async () => {
    const { articleId } = await seed();
    const repo = new Repository(db);
    await repo.saveArticle(1, articleId, ['rust']);
    await repo.saveArticle(1, articleId + 1, ['go']);
    expect(await run('list_saved', { query: 'tag:go' })).toMatchObject({
      saves: [{ tags: ['go'] }],
      tags: ['go', 'rust'],
    });
  });
});

describe('get_briefing', () => {
  it('lays out the latest edition', async () => {
    await seed();
    expect(await run('get_briefing')).toMatchObject({
      date: '2026-11-01',
      sections: [{ desks: [{ url: 'https://a.test/feed' }] }],
    });
  });

  it('refuses a date that is not on the calendar', async () => {
    await expect(run('get_briefing', { date: '2026-02-31' })).rejects.toThrow(
      'That is not a calendar date.',
    );
  });
});

describe('get_trending', () => {
  it('ranks stories by how many read them, from two readers', async () => {
    const { articleId } = await seed();
    const repo = new Repository(db);
    await repo.markRead(1, articleId);
    expect(await run('get_trending')).toEqual({ articles: [] });
    await repo.addFeed(2, 'https://a.test/feed');
    await repo.markRead(2, articleId);
    expect(await run('get_trending')).toEqual({
      articles: [
        expect.objectContaining({ title: 'Rust ships', read_count: 2 }),
      ],
    });
  });

  it('leaves out what the person read when asked for unread', async () => {
    const { articleId } = await seed();
    const repo = new Repository(db);
    await repo.addFeed(2, 'https://a.test/feed');
    await repo.markRead(1, articleId);
    await repo.markRead(2, articleId);
    expect(await run('get_trending', { unread: true })).toEqual({
      articles: [],
    });
  });

  it('refuses a list NewsBlur does not have', () => {
    const found = TOOLS.find((t) => t.name === 'get_trending')!;
    expect(found.input.safeParse({ order: 'hot' }).success).toBe(false);
    expect(found.input.safeParse({ order: 'long_reads' }).success).toBe(true);
  });
});

describe('discover_feeds', () => {
  it('offers the starter topics', async () => {
    const found = (await run('discover_feeds')) as { topics: object[] };
    expect(found.topics.length).toBeGreaterThan(0);
  });

  it('refuses an unknown topic', async () => {
    await expect(run('discover_feeds', { topic: 'nope' })).rejects.toThrow(
      'There is no such topic.',
    );
  });
});

describe('ask_archive', () => {
  const answering = (response: unknown) => ({
    run: async () => ({ response }),
  });

  it('answers in a new conversation and keeps both turns', async () => {
    await seed();
    ctx = { ...ctx, model: answering('Rust shipped.') };
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
    ctx = { ...ctx, model: answering('x') };
    await expect(
      run('ask_archive', { question: 'Hi', conversation_id: theirs.id }),
    ).rejects.toThrow('There is no such conversation.');
  });

  it('refuses once today’s assistant budget is used up', async () => {
    const repo = new Repository(db);
    for (let i = 0; i < DAILY_LIMITS.assistant; i++) {
      await repo.recordUsage(ctx.uid, 'assistant');
    }
    ctx = { ...ctx, model: answering('x') };
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
    (
      (await run('search_articles', args)) as { articles: { title: string }[] }
    ).articles.map((a) => a.title);

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
    const found = TOOLS.find((t) => t.name === 'search_articles')!;
    expect(found.input.safeParse({ domain: "x' or 1" }).success).toBe(false);
  });

  it('narrows to a range of editions', async () => {
    await seed();
    await second();
    expect(await titles({ date_to: '2026-10-15' })).toEqual(['Zig ships']);
    expect(await titles({ date_from: '2026-10-15' })).toHaveLength(2);
  });

  it('refuses a day that is not on the calendar', () => {
    const found = TOOLS.find((t) => t.name === 'search_articles')!;
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
    const page = (await run('search_articles', {
      read_filter: 'unread',
      limit: 1,
    })) as { articles: { title: string }[]; next_before?: number };
    expect(page).toEqual({
      articles: [expect.objectContaining({ title: 'Rust ships' })],
    });
  });
});

describe('collect', () => {
  const rows = Array.from({ length: 250 }, (_, i) => ({ id: 250 - i }));
  const fetch = async (before: number | undefined, limit: number) =>
    rows
      .filter((r) => before === undefined || r.id < before)
      .slice(0, limit + 1);

  it('reads past batches until the page is full', async () => {
    const { items, next } = await collect(fetch, (r) => r.id % 50 === 0, 3);
    expect([items.map((r) => r.id), next]).toEqual([[250, 200, 150], 150]);
  });

  it('says nothing follows once the rows run out', async () => {
    const { next } = await collect(fetch, (r) => r.id === 1, 5);
    expect(next).toBeUndefined();
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

describe('save_article notes and highlights', () => {
  it('keeps a note and highlights, and the tags when none are sent', async () => {
    const { articleId } = await seed();
    await run('save_article', { article_id: articleId, tags: ['rust'] });
    expect(
      await run('save_article', {
        article_id: articleId,
        notes: ' Read later ',
        highlights: ['ships'],
      }),
    ).toMatchObject({
      save: { tags: ['rust'], notes: 'Read later', highlights: ['ships'] },
    });
  });

  it('clears the note with null', async () => {
    const { articleId } = await seed();
    await run('save_article', { article_id: articleId, notes: 'x' });
    const { save } = (await run('save_article', {
      article_id: articleId,
      notes: null,
    })) as { save: object };
    expect(save).not.toHaveProperty('notes');
  });
});

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

describe('organize_feed more ways', () => {
  it('mutes until a time and moves the feed', async () => {
    const { feedId } = await seed();
    expect(
      await run('organize_feed', {
        feed_id: feedId,
        muted: true,
        muted_until: '2099-01-01T00:00:00Z',
        position: 3,
      }),
    ).toMatchObject({
      feed: { muted: true, muted_until: '2099-01-01T00:00:00Z', position: 3 },
    });
  });
});

describe('nested sections', () => {
  it('adds a section under another', async () => {
    const top = await new Repository(db).addSection(1, 'Top');
    expect(
      await run('add_section', { name: 'Inner', parent_id: top.id }),
    ).toMatchObject({ section: { parent_id: String(top.id) } });
  });

  it("refuses another person's parent", async () => {
    const theirs = await new Repository(db).addSection(2, 'Theirs');
    await expect(
      run('add_section', { name: 'x', parent_id: theirs.id }),
    ).rejects.toThrow('There is no such parent section.');
  });

  it('refuses to nest a section inside itself', async () => {
    const top = await new Repository(db).addSection(1, 'Top');
    await expect(
      run('update_section', { section_id: top.id, parent_id: top.id }),
    ).rejects.toThrow('The parent must be another of your sections');
  });

  it('moves a section to the top level', async () => {
    const repo = new Repository(db);
    const top = await repo.addSection(1, 'Top');
    const inner = await repo.addSection(1, 'Inner', undefined, top.id);
    const { section } = (await run('update_section', {
      section_id: inner.id,
      parent_id: null,
    })) as { section: object };
    expect(section).not.toHaveProperty('parent_id');
  });
});

describe('sharing', () => {
  it('shares with a comment, without the sharer’s email', async () => {
    const { articleId } = await seed();
    const result = (await run('share_story', {
      article_id: articleId,
      comments: 'Worth it',
    })) as { share: Record<string, unknown>; created: boolean };
    expect(JSON.stringify(result)).not.toContain('a@b.com');
    expect(result).toMatchObject({
      created: true,
      share: { comments: 'Worth it', article: { title: 'Rust ships' } },
    });
  });

  it('refuses an article the caller cannot see', async () => {
    const { articleId } = await seed();
    ctx = { ...ctx, uid: 2 };
    await expect(run('share_story', { article_id: articleId })).rejects.toThrow(
      'There is no such article.',
    );
  });

  it('lists everyone’s shares, or chosen people’s', async () => {
    const { articleId } = await seed();
    await run('share_story', { article_id: articleId });
    ctx = { ...ctx, uid: 2 };
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

describe('get_infrequent_stories', () => {
  it('lists stories from feeds under the monthly limit', async () => {
    await seed();
    const busy = (await new Repository(db).addFeed(1, 'https://b.test/feed'))!;
    const today = new Date().toISOString().slice(0, 10);
    await new Repository(db).writeEdition(
      busy.source_id,
      today,
      Array.from({ length: 5 }, (_, i) => item(`https://b.test/${i}`, `B${i}`)),
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

describe('get_archive_stats', () => {
  it('counts the archive per feed', async () => {
    const { feedId, articleId } = await seed();
    await new Repository(db).markRead(1, articleId);
    expect(await run('get_archive_stats')).toMatchObject({
      articles: 2,
      editions: 1,
      oldest_edition: '2026-11-01',
      read: 1,
      saved: 0,
      feeds: [{ feed_id: String(feedId), articles: 2 }],
    });
  });
});

describe('manage_notifications', () => {
  it('sets, lists and removes a feed’s notifications', async () => {
    const { feedId } = await seed();
    expect(
      await run('manage_notifications', {
        action: 'set',
        feed_id: feedId,
        channels: ['web'],
        filter: 'focus',
      }),
    ).toMatchObject({ created: true, notification: { filter: 'focus' } });
    expect(await run('manage_notifications', { action: 'list' })).toMatchObject(
      { notifications: [{ feed_id: String(feedId), channels: ['web'] }] },
    );
    expect(
      await run('manage_notifications', { action: 'remove', feed_id: feedId }),
    ).toEqual({ removed: true });
  });

  it('needs a feed to set', async () => {
    await expect(
      run('manage_notifications', { action: 'set', channels: ['web'] }),
    ).rejects.toThrow('Send feed_id.');
  });

  it("refuses another person's feed", async () => {
    const other = (await new Repository(db).addFeed(2, 'https://o.test/f'))!;
    await expect(
      run('manage_notifications', {
        action: 'set',
        feed_id: other.id,
        channels: ['web'],
      }),
    ).rejects.toThrow('There is no such feed.');
  });

  it('refuses to remove what is not set', async () => {
    const { feedId } = await seed();
    await expect(
      run('manage_notifications', { action: 'remove', feed_id: feedId }),
    ).rejects.toThrow('That feed has no notifications.');
  });
});
