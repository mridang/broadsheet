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
