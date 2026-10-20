import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from '@jest/globals';
import type { DatabaseSync } from 'node:sqlite';

import { sqliteD1 } from './sqlite-d1';

let raw: DatabaseSync;

/** The database as it was before the migration, with people, feeds and articles in it. */
beforeEach(() => {
  raw = sqliteD1('0001_init.sql', '0002_editions.sql', '0003_points.sql').raw;
  const user = raw.prepare(
    'INSERT INTO users (id, sub, email, name, picture, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  user.run(1, 'google-1', 'ada@example.com', 'Ada', 'https://p/a', 'then');
  user.run(2, 'dev:x@example.com', 'x@example.com', 'x', '', 'then');
  user.run(3, '__public__', 'public', 'Hacker News', '', 'then');
  user.run(4, null, null, null, null, 'then');
  const feed = raw.prepare(
    'INSERT INTO feeds (id, user_id, url) VALUES (?, ?, ?)',
  );
  [1, 2, 3, 4].forEach((id) => feed.run(id, id, `https://f/${id}`));
  const article = raw.prepare(
    "INSERT INTO articles (feed_id, url, edition) VALUES (?, ?, '2026-10-20')",
  );
  [1, 2, 3, 4].forEach((id) => article.run(id, `https://x/${id}`));
  raw.exec(
    readFileSync(
      path.join(process.cwd(), 'migrations', '0004_google_sign_in.sql'),
      'utf8',
    ),
  );
});

/** The ids in a column of a table, in order. */
const ids = (sql: string) =>
  raw
    .prepare(sql)
    .all()
    .map((row) => Number(row['id']));

describe('0004_google_sign_in.sql', () => {
  it('moves the Google account id to google_sub, keeping real accounts and the public user as they were', () => {
    expect(
      raw.prepare('SELECT * FROM users WHERE id IN (1, 3) ORDER BY id').all(),
    ).toEqual([
      {
        id: 1,
        google_sub: 'google-1',
        email: 'ada@example.com',
        name: 'Ada',
        picture: 'https://p/a',
        session_epoch: 0,
        created_at: 'then',
      },
      {
        id: 3,
        google_sub: '__public__',
        email: 'public',
        name: 'Hacker News',
        picture: '',
        session_epoch: 0,
        created_at: 'then',
      },
    ]);
  });

  it('removes the throwaway dev accounts and any account with no Google id, with their feeds and articles', () => {
    expect(ids('SELECT id FROM users ORDER BY id')).toEqual([1, 3]);
    expect(ids('SELECT id FROM feeds ORDER BY id')).toEqual([1, 3]);
    expect(ids('SELECT feed_id AS id FROM articles ORDER BY feed_id')).toEqual([
      1, 3,
    ]);
  });

  it('keeps the Google account id unique and the email required', () => {
    const insert = raw.prepare(
      'INSERT INTO users (google_sub, email) VALUES (?, ?)',
    );
    expect(() => insert.run('google-1', 'again@example.com')).toThrow(/UNIQUE/);
    expect(() => insert.run('google-2', null)).toThrow(/NOT NULL/);
  });

  it('starts every account on epoch 0 and numbers new ones after the highest id kept', () => {
    raw
      .prepare('INSERT INTO users (google_sub, email) VALUES (?, ?)')
      .run('google-9', 'new@example.com');
    expect(
      raw.prepare('SELECT session_epoch AS e FROM users WHERE id > 3').get(),
    ).toEqual({ e: 0 });
    expect(ids('SELECT id FROM users ORDER BY id')).toEqual([1, 3, 4]);
  });
});
