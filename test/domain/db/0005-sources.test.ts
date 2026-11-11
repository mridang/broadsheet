import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it } from '@jest/globals';

import type { DatabaseSync } from 'node:sqlite';

import { sqliteD1 } from '../../lib/core/db/sqlite-d1';

let raw: DatabaseSync;

/** Two people following one address, one following another, with articles. */
beforeEach(async () => {
  raw = sqliteD1(
    '0001_init.sql',
    '0002_editions.sql',
    '0003_points.sql',
    '0004_google_sign_in.sql',
  ).raw;
  raw.exec(
    "INSERT INTO users (id, google_sub, email) VALUES (1, 'g1', 'a'), (2, 'g2', 'b')",
  );
  const feed = raw.prepare(
    'INSERT INTO feeds (id, user_id, url, title, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  feed.run(10, 1, 'https://hn.test/rss', 'Hacker News', 'then');
  feed.run(11, 2, 'https://hn.test/rss', 'HN', 'later');
  feed.run(12, 2, 'https://blog.test/atom', 'Blog', 'now');
  const article = raw.prepare(
    "INSERT INTO articles (id, feed_id, url, title, edition) VALUES (?, ?, ?, ?, '2026-10-20')",
  );
  article.run(100, 10, 'https://x/1', 'One');
  article.run(101, 11, 'https://x/1', 'One again');
  article.run(102, 12, 'https://x/2', 'Two');
  raw.exec(
    await readFile(
      path.join(process.cwd(), 'migrations', '0005_sources.sql'),
      'utf8',
    ),
  );
});

const all = (sql: string) => raw.prepare(sql).all();

describe('0005_sources.sql', () => {
  it('makes one source per distinct address', () => {
    expect(all('SELECT url, fail_count FROM sources ORDER BY id')).toEqual([
      { url: 'https://hn.test/rss', fail_count: 0 },
      { url: 'https://blog.test/atom', fail_count: 0 },
    ]);
  });

  it('makes one subscription per old feed, keeping its id, owner and creation time', () => {
    expect(
      all(
        'SELECT s.id, s.user_id, src.url, s.muted, s.section_id, s.created_at FROM subscriptions s JOIN sources src ON src.id = s.source_id ORDER BY s.id',
      ),
    ).toEqual([
      {
        id: 10,
        user_id: 1,
        url: 'https://hn.test/rss',
        muted: 0,
        section_id: null,
        created_at: 'then',
      },
      {
        id: 11,
        user_id: 2,
        url: 'https://hn.test/rss',
        muted: 0,
        section_id: null,
        created_at: 'later',
      },
      {
        id: 12,
        user_id: 2,
        url: 'https://blog.test/atom',
        muted: 0,
        section_id: null,
        created_at: 'now',
      },
    ]);
  });

  it('keeps a person’s own name for a shared feed as their title override', () => {
    expect(
      all(
        'SELECT coalesce(s.title_override, src.title) AS title FROM subscriptions s JOIN sources src ON src.id = s.source_id ORDER BY s.id',
      ).map((r) => r['title']),
    ).toEqual(['Hacker News', 'HN', 'Blog']);
  });

  it('moves articles to their source, collapsing copies of the same story', () => {
    expect(
      all(
        'SELECT a.id, src.url AS source FROM articles a JOIN sources src ON src.id = a.source_id ORDER BY a.id',
      ),
    ).toEqual([
      { id: 100, source: 'https://hn.test/rss' },
      { id: 102, source: 'https://blog.test/atom' },
    ]);
  });

  it('drops the old feeds table and starts with no sections', () => {
    expect(
      all(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'feeds'",
      ),
    ).toEqual([]);
    expect(all('SELECT * FROM sections')).toEqual([]);
  });
});
