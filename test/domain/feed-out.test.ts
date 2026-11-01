import { beforeEach, describe, expect, it } from '@jest/globals';

import { databaseFrom, type Database } from '@/domain/db/database';
import { highlightsText, keeps, serveFeed } from '@/domain/feed-out';
import { OutboundRepository, type FeedTokenInput } from '@/domain/outbound';
import { Repository } from '@/domain/repository';
import { sha256Hex } from '@/lib/outbound/tokens';
import type { ScrapedItem } from '@/lib/scraping';
import { APP_MIGRATIONS } from '../lib/core/db/migrations';
import { sqliteD1 } from '../lib/core/db/sqlite-d1';

let db: Database;
const ORIGIN = 'https://paper.test';

beforeEach(() => {
  db = databaseFrom(sqliteD1(...APP_MIGRATIONS).d1);
});

const story = (
  url: string,
  title: string,
  body_text?: string,
): ScrapedItem => ({
  ...(body_text ? { body_text } : {}),
  url,
  title,
  source: 'Src',
  favicon: '',
  summary: '',
  image: '',
  published_at: '',
  points: 0,
});

/** A token for person 1 with this scope; the token text. */
async function token(input: FeedTokenInput): Promise<string> {
  await new OutboundRepository(db).addFeedToken(1, await sha256Hex('t'), input);
  return 't';
}

const fetchFeed = (query: string) =>
  serveFeed(
    new Request(`${ORIGIN}/feed.xml${query}`),
    db,
    ORIGIN,
    new Date('2026-10-03T00:00:00Z'),
  );

/** Person 1 follows two feeds, one in a section, with today's stories. */
async function paper(): Promise<{ sectionId: number; articleId: number }> {
  const repo = new Repository(db);
  const section = await repo.addSection(1, 'Tech');
  const a = (await repo.addFeed(1, 'https://a.test/f'))!;
  const b = (await repo.addFeed(1, 'https://b.test/f'))!;
  await repo.updateFeed(1, a.id, { section_id: section.id });
  await repo.writeEdition(a.source_id, '2026-10-02', [
    story('https://x/a', 'Alpha', 'Alpha body.'),
  ]);
  await repo.writeEdition(b.source_id, '2026-10-02', [
    story('https://x/b', 'Beta'),
  ]);
  const [article] = await repo.sourceArticles(a.source_id, '2026-10-02');
  return { sectionId: section.id, articleId: article!.id };
}

describe('serveFeed', () => {
  it('serves the saves with one tag as Atom', async () => {
    const { articleId } = await paper();
    const repo = new Repository(db);
    await repo.saveArticle(1, articleId, ['rust']);
    const res = await fetchFeed(
      `?token=${await token({ scope: 'saves', tag: 'rust' })}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(
      'application/atom+xml; charset=utf-8',
    );
    const xml = await res.text();
    expect(xml).toContain('Saved: rust');
    expect(xml).toContain('<title>Alpha</title>');
  });

  it('serves one section', async () => {
    const { sectionId } = await paper();
    const xml = await (
      await fetchFeed(
        `?token=${await token({ scope: 'section', section_id: sectionId })}`,
      )
    ).text();
    expect(xml).toContain('<title>Alpha</title>');
    expect(xml).not.toContain('<title>Beta</title>');
  });

  it('serves the whole edition', async () => {
    await paper();
    const xml = await (
      await fetchFeed(`?token=${await token({ scope: 'edition' })}`)
    ).text();
    expect(xml).toContain('<title>Alpha</title>');
    expect(xml).toContain('<title>Beta</title>');
    expect(xml).toContain('<updated>2026-10-02T00:00:00Z</updated>');
  });

  it('serves only the saves with highlights, quoting them', async () => {
    const { articleId } = await paper();
    const repo = new Repository(db);
    const [beta] = await repo.searchArticles(1, { q: 'Beta', limit: 1 });
    await repo.saveArticle(1, articleId, []);
    await repo.saveArticle(1, beta!.id, []);
    await repo.annotateSave(1, articleId, {
      highlights: ['Alpha body'],
      notes: 'Worth it',
    });
    const xml = await (
      await fetchFeed(`?token=${await token({ scope: 'highlights' })}`)
    ).text();
    expect(xml).toContain(': Highlights</title>');
    expect(xml).toContain('<title>Alpha</title>');
    expect(xml).not.toContain('<title>Beta</title>');
    expect(xml).toContain('“Alpha body”\n\nWorth it');
  });

  it('refuses a request without a token in plain text', async () => {
    const res = await fetchFeed('');
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
  });

  it('answers 404 for an unknown token', async () => {
    expect((await fetchFeed('?token=nope')).status).toBe(404);
  });

  it('serves what a saved search finds', async () => {
    await paper();
    const { search } = await new Repository(db).addSearch(1, 'alpha', null);
    const xml = await (
      await fetchFeed(
        `?token=${await token({ scope: 'search', search_id: search.id })}`,
      )
    ).text();
    expect(xml).toContain('Search: alpha');
    expect(xml).toContain('<title>Alpha</title>');
    expect(xml).not.toContain('<title>Beta</title>');
  });

  it('answers 404 when the saved search has gone', async () => {
    const { search } = await new Repository(db).addSearch(1, 'alpha', null);
    const t = await token({ scope: 'search', search_id: search.id });
    await new Repository(db).removeSearch(1, search.id);
    expect((await fetchFeed(`?token=${t}`)).status).toBe(404);
  });

  it('answers 404 when the section has gone', async () => {
    const { sectionId } = await paper();
    const t = await token({ scope: 'section', section_id: sectionId });
    await new Repository(db).removeSection(1, sectionId);
    expect((await fetchFeed(`?token=${t}`)).status).toBe(404);
  });
});

describe('highlightsText', () => {
  it('quotes each passage, then the note', () => {
    expect(highlightsText(['a', 'b'], 'n')).toBe('“a”\n\n“b”\n\nn');
  });

  it('leaves out a missing note', () => {
    expect(highlightsText(['a'], null)).toBe('“a”');
  });
});

describe('keeps', () => {
  it.each([
    ['all', -1, true],
    ['all', -2, true],
    ['unread', -2, false],
    ['unread', -1, false],
    ['unread', 0, true],
    ['focus', 0, false],
    ['focus', 1, true],
  ] as const)('a %s feed keeps a story scored %d: %s', (filter, score, yes) => {
    expect(keeps(filter, score)).toBe(yes);
  });
});

describe('serveFeed filters and content', () => {
  it('carries each story’s kept text and a saved story’s tags', async () => {
    const { articleId } = await paper();
    await new Repository(db).saveArticle(1, articleId, ['rust', 'go']);
    const xml = await (
      await fetchFeed(`?token=${await token({ scope: 'saves' })}`)
    ).text();
    expect(xml).toContain('<content type="text">Alpha body.</content>');
    expect(xml).toContain('<category term="rust"/>');
  });

  it('leaves disliked stories out of an unread edition feed', async () => {
    await paper();
    await new Repository(db).addClassifier(1, {
      kind: 'title',
      value: 'beta',
      score: -1,
    });
    const xml = await (
      await fetchFeed(
        `?token=${await token({ scope: 'edition', filter: 'unread' })}`,
      )
    ).text();
    expect(xml).toContain('<title>Alpha</title>');
    expect(xml).not.toContain('<title>Beta</title>');
  });

  it('keeps only liked stories in a focus feed, and says so in its title', async () => {
    await paper();
    await new Repository(db).addClassifier(1, {
      kind: 'title',
      value: 'beta',
      score: 1,
    });
    const xml = await (
      await fetchFeed(
        `?token=${await token({ scope: 'edition', filter: 'focus' })}`,
      )
    ).text();
    expect(xml).toContain('(focus)');
    expect(xml).toContain('<title>Beta</title>');
    expect(xml).not.toContain('<title>Alpha</title>');
  });
});

describe('serveFeed links', () => {
  it('links a saves feed to its page on the site', async () => {
    const xml = await (
      await fetchFeed(`?token=${await token({ scope: 'saves', tag: 'a b' })}`)
    ).text();
    expect(xml).toContain(
      '<link rel="alternate" href="https://paper.test/saved?tag=a%20b"/>',
    );
  });
});
