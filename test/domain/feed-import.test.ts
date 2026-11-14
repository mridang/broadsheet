import { beforeEach, describe, expect, it } from '@jest/globals';

import { databaseFrom } from '@/domain/db/client';
import { comparable, importFeeds } from '@/domain/feed-import';
import { Repository } from '@/domain/repository';
import { APP_MIGRATIONS } from '../lib/core/db/migrations';
import { sqliteD1 } from '../lib/core/db/sqlite-d1';
import insecure from '../fixtures/insecure-urls.json';

let repo: Repository;

beforeEach(() => {
  repo = new Repository(databaseFrom(sqliteD1(...APP_MIGRATIONS).d1));
});

describe('importFeeds', () => {
  it('follows new feeds, filing them under sections it creates or reuses', async () => {
    await repo.addSection(1, 'tech');
    const summary = await importFeeds(repo, 1, [
      { url: 'https://a.test/1', title: 'One', sections: ['Tech'] },
      { url: 'https://a.test/2', sections: ['News'] },
      { url: 'https://a.test/3', sections: ['News'] },
    ]);
    expect(summary).toMatchObject({
      added: 3,
      skipped: 0,
      sections_added: 1,
      rejected: [],
    });
    const sectionsAfter = await repo.listSections(1);
    expect(sectionsAfter.map((s) => s.name)).toEqual(['tech', 'News']);
    const feedsAfter = await repo.listFeeds(1);
    expect(feedsAfter.map((f) => f.section_id)).toEqual([1, 2, 2]);
  });

  it('skips feeds already followed and rejects invalid ones', async () => {
    await repo.addFeed(1, 'https://a.test/1');
    const summary = await importFeeds(repo, 1, [
      { url: 'https://a.test/1', sections: ['Ignored'] },
      { url: 'ftp://a.test/2' },
      { url: 'nonsense' },
    ]);
    expect(summary).toMatchObject({ added: 0, skipped: 1, sections_added: 0 });
    expect(summary.rejected.map((r) => r.url)).toEqual([
      'ftp://a.test/2',
      'nonsense',
    ]);
    expect(await repo.listSections(1)).toEqual([]);
  });
});

describe('importFeeds nesting, matching and names', () => {
  it('creates nested sections for nested folders, reusing those that exist', async () => {
    await importFeeds(repo, 1, [
      { url: 'https://a.test/1', sections: ['A', 'B'] },
      { url: 'https://a.test/2', sections: ['a', 'B'] },
      { url: 'https://a.test/3', sections: ['A'] },
    ]);
    const sections = await repo.listSections(1);
    expect(sections.map((s) => [s.name, s.parent_id])).toEqual([
      ['A', null],
      ['B', sections[0]!.id],
    ]);
    const feeds = await repo.listFeeds(1);
    expect(feeds.map((f) => f.section_id)).toEqual([
      sections[1]!.id,
      sections[1]!.id,
      sections[0]!.id,
    ]);
  });

  it('treats the same feed under another scheme, www or slash as already followed', async () => {
    await repo.addFeed(1, 'https://www.a.test/feed/');
    const summary = await importFeeds(repo, 1, [
      { url: insecure.httpFeedOtherScheme },
      { url: 'https://a.test/feed#top' },
    ]);
    expect(summary).toMatchObject({ added: 0, skipped: 2 });
  });

  it('treats a feed whose website the person already follows as followed', async () => {
    const feed = (await repo.addFeed(1, 'https://a.test/feed'))!;
    await repo.recordDetails(
      feed.source_id,
      { site_url: 'https://a.test/' } as never,
      [],
    );
    const summary = await importFeeds(repo, 1, [
      { url: 'https://a.test/other.xml', site_url: insecure.httpSiteUrl },
    ]);
    expect(summary).toMatchObject({ added: 0, skipped: 1 });
  });

  it('keeps the name in the file as the person’s own when the feed is named otherwise', async () => {
    await repo.addFeed(2, 'https://a.test/f', 'The Source Name');
    await importFeeds(repo, 1, [{ url: 'https://a.test/f', title: 'My Name' }]);
    const [mine] = await repo.listFeeds(1);
    const [theirs] = await repo.listFeeds(2);
    expect(mine?.title).toBe('My Name');
    expect(theirs?.title).toBe('The Source Name');
  });
});

describe('importFeeds by name', () => {
  it('skips a feed that carries the name of one already followed, ignoring case', async () => {
    await repo.addFeed(1, 'https://a.test/f', 'The Daily');
    const summary = await importFeeds(repo, 1, [
      { url: 'https://b.test/other', title: ' the daily ' },
      { url: 'https://b.test/one', title: 'Same' },
      { url: 'https://c.test/two', title: 'SAME' },
    ]);
    expect(summary).toMatchObject({ added: 1, skipped: 2 });
  });
});

describe('comparable', () => {
  it('is empty for nothing or a non-address', () => {
    expect(comparable(undefined)).toBe('');
    expect(comparable('nonsense')).toBe('');
  });
  it('ignores scheme, www, fragment and trailing slashes but not the query', () => {
    expect(comparable('HTTPS://www.A.test/x/#f')).toBe('a.test/x');
    expect(comparable('https://a.test/x?y=1')).toBe('a.test/x?y=1');
  });

  it('files a feed listed under two folders in both sections', async () => {
    const summary = await importFeeds(repo, 1, [
      { url: 'https://a.test/1', sections: ['Tech'] },
      { url: 'https://a.test/1', sections: ['News'] },
      { url: 'https://a.test/1', sections: ['News'] },
    ]);
    expect(summary).toMatchObject({ added: 1, skipped: 0, sections_added: 2 });
    const [tech, news] = await repo.listSections(1);
    const [listed] = await repo.listFeeds(1);
    expect(listed?.section_ids).toEqual([tech!.id, news!.id]);
    expect(summary.feeds[0]?.section_ids).toEqual([tech!.id, news!.id]);
  });
});

describe('comparable trailing slashes', () => {
  it.each([
    ['https://a.test', 'a.test'],
    ['https://a.test/', 'a.test'],
    ['https://a.test////', 'a.test'],
    ['https://a.test/x///?q=1', 'a.test/x?q=1'],
    ['https://a.test/x//y/', 'a.test/x//y'],
  ])('reads %s as %s', (address, expected) => {
    expect(comparable(address)).toBe(expected);
  });
});
