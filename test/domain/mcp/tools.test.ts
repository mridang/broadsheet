import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { databaseFrom, type Database } from '@/domain/db/database';
import { TOOLS, type ToolContext } from '@/domain/mcp/tools';
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
    expect(
      await run('search_articles', { query: 'Rust', feed_id: other.id }),
    ).toEqual({ articles: [] });
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
  ])('keeps only %s stories', async (read_filter, titles) => {
    const { articleId } = await seed();
    await new Repository(db).markRead(1, articleId);
    const found = (await run('search_articles', {
      query: '',
      read_filter,
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

  it('needs ids or a feed', async () => {
    await expect(run('mark_read')).rejects.toThrow(
      'Send article_ids or feed_id.',
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
  it('ranks stories by how many read them', async () => {
    const { articleId } = await seed();
    await new Repository(db).markRead(1, articleId);
    expect(await run('get_trending')).toEqual({
      articles: [
        expect.objectContaining({ title: 'Rust ships', read_count: 1 }),
      ],
    });
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
    expect([
      result.message.content,
      (await new Repository(db).listMessages(Number(result.conversation_id)))
        .length,
    ]).toEqual(['Rust shipped.', 2]);
  });

  it("refuses another person's conversation", async () => {
    const theirs = await new Repository(db).addConversation(2);
    ctx = { ...ctx, model: answering('x') };
    await expect(
      run('ask_archive', { question: 'Hi', conversation_id: theirs.id }),
    ).rejects.toThrow('There is no such conversation.');
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
