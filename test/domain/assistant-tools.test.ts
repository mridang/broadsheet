import { beforeEach, describe, expect, it } from '@jest/globals';
import { sql } from 'drizzle-orm';

import { ASSISTANT_TOOLS, ToolRunner } from '@/domain/assistant-tools';
import { databaseFrom, type Database } from '@/domain/db/database';
import { Repository } from '@/domain/repository';
import type { ScrapedItem } from '@/lib/scraping';
import { APP_MIGRATIONS } from '../lib/core/db/migrations';
import { sqliteD1 } from '../lib/core/db/sqlite-d1';

let db: Database;
let repo: Repository;
let rust: number;
let other: number;

const story = (over: Partial<ScrapedItem>): ScrapedItem => ({
  url: 'https://x/1',
  title: 'Untitled',
  source: 'LWN',
  favicon: '',
  summary: '',
  image: '',
  published_at: '',
  points: 0,
  ...over,
});

/** Person 1 follows a source with a rust story and saved it as "lang"; person 2 follows another. */
beforeEach(async () => {
  db = databaseFrom(sqliteD1(...APP_MIGRATIONS).d1);
  repo = new Repository(db);
  const a = (await repo.addFeed(1, 'https://a.test/f'))!;
  const b = (await repo.addFeed(2, 'https://b.test/f'))!;
  await repo.writeEdition(a.source_id, '2026-10-20', [
    story({ title: 'Rust borrow', body_text: 'rust borrow checker' }),
  ]);
  await repo.writeEdition(b.source_id, '2026-10-21', [
    story({ url: 'https://x/2', title: 'Secret', body_text: 'rust private' }),
  ]);
  rust = (await repo.sourceArticles(a.source_id, '2026-10-20'))[0]!.id;
  other = (await repo.sourceArticles(b.source_id, '2026-10-21'))[0]!.id;
  await repo.saveArticle(1, rust, ['lang']);
});

const tools = () => new ToolRunner(repo, 1);

describe('ASSISTANT_TOOLS', () => {
  it('offers NewsBlur’s archive tools', () => {
    expect(ASSISTANT_TOOLS.map((t) => t.function.name)).toEqual([
      'search_stories',
      'search_saved_stories',
      'saved_summary',
      'search_shared_stories',
      'recent_reads',
      'get_story',
      'archive_summary',
    ]);
  });
});

describe('ToolRunner', () => {
  it('searches the archive and remembers what it showed', async () => {
    const runner = tools();
    const out = await runner.run({
      name: 'search_stories',
      arguments: { query: 'borrow' },
    });
    expect(out).toContain(`<story id="${rust}">`);
    expect([...runner.seen.keys()]).toEqual([rust]);
  });

  it('never shows another person’s stories', async () => {
    const out = await tools().run({
      name: 'search_stories',
      arguments: { query: 'private' },
    });
    expect(out).toBe('No stories found.');
  });

  it.each([
    [{ query: 'rust', since: '2026-10-21' }, 'No stories found.'],
    [{ query: 'rust', until: '2026-10-20' }, 'Rust borrow'],
    [{ query: 'rust', source: 'nowhere' }, 'No stories found.'],
    [{ query: 'rust', source: 'lwn' }, 'Rust borrow'],
  ])('narrows a search by %j', async (args, expected) => {
    expect(
      await tools().run({ name: 'search_stories', arguments: args }),
    ).toContain(expected);
  });

  it('ignores a date that is not YYYY-MM-DD', async () => {
    expect(
      await tools().run({
        name: 'search_stories',
        arguments: { query: 'rust', since: 'tomorrow' },
      }),
    ).toContain('Rust borrow');
  });

  it('asks for a query when a search has none', async () => {
    expect(await tools().run({ name: 'search_stories', arguments: {} })).toBe(
      'search_stories needs a query.',
    );
  });

  it.each([
    [{ tag: 'lang' }, 'Rust borrow'],
    [{ tag: 'other' }, 'No stories found.'],
    [{ query: 'checker' }, 'Rust borrow'],
  ])('searches saves by %j', async (args, expected) => {
    expect(
      await tools().run({ name: 'search_saved_stories', arguments: args }),
    ).toContain(expected);
  });

  it('lists recent reads', async () => {
    await repo.markRead(1, rust);
    expect(
      await tools().run({ name: 'recent_reads', arguments: { days: 7 } }),
    ).toContain('Rust borrow');
  });

  it('reads one reachable story in full', async () => {
    const runner = tools();
    expect(
      await runner.run({ name: 'get_story', arguments: { id: rust } }),
    ).toContain('rust borrow checker');
    expect(runner.seen.has(rust)).toBe(true);
  });

  it.each([{ id: 'x' }, {}])('refuses get_story %j', async (args) => {
    expect(await tools().run({ name: 'get_story', arguments: args })).toMatch(
      /^No story with id/,
    );
  });

  it('refuses a story the person cannot reach', async () => {
    expect(
      await tools().run({ name: 'get_story', arguments: { id: other } }),
    ).toBe(`No story with id ${other}.`);
  });

  it('summarises the archive', async () => {
    expect(
      JSON.parse(await tools().run({ name: 'archive_summary', arguments: {} })),
    ).toMatchObject({
      sources: 1,
      saves: 1,
      tags: [{ tag: 'lang', count: 1 }],
    });
  });

  it('says when there is no such tool', async () => {
    expect(await tools().run({ name: 'rm', arguments: {} })).toBe(
      'There is no tool called rm.',
    );
  });
});

describe('ToolRunner on saves and shares', () => {
  beforeEach(async () => {
    await db.run(
      sql`UPDATE saves SET notes = 'Read again', highlights = '["borrow checker"]' WHERE article_id = ${rust}`,
    );
    await db.run(
      sql`INSERT INTO users (id, google_sub, email, name, session_epoch) VALUES (2, 'g2', 'b@b.com', 'Bea', 0)`,
    );
    await db.run(
      sql`INSERT INTO shares (user_id, article_id, comments) VALUES (2, ${other}, 'Worth it')`,
    );
  });

  it('shows a saver’s note and highlights with saved stories', async () => {
    const out = await tools().run({
      name: 'search_saved_stories',
      arguments: { tag: 'lang' },
    });
    expect(out).toContain('Note: Read again');
    expect(out).toContain('Highlights: "borrow checker"');
  });

  it('shows them when reading a saved story in full', async () => {
    expect(
      await tools().run({ name: 'get_story', arguments: { id: rust } }),
    ).toContain('Note: Read again');
  });

  it('searches shared stories with who shared them', async () => {
    const runner = tools();
    const out = await runner.run({
      name: 'search_shared_stories',
      arguments: { query: 'private' },
    });
    expect(out).toContain('Shared by Bea: Worth it');
    expect(runner.seen.has(other)).toBe(true);
  });

  it('summarises the saves', async () => {
    const runner = tools();
    expect(
      JSON.parse(await runner.run({ name: 'saved_summary', arguments: {} })),
    ).toMatchObject({
      saves: 1,
      tags: [{ tag: 'lang', count: 1 }],
      top_sources: [{ source: 'LWN', count: 1 }],
      recent: [{ id: rust, title: 'Rust borrow' }],
    });
    expect(runner.seen.has(rust)).toBe(true);
  });
});
