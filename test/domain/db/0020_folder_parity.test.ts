import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from '@jest/globals';
import type { DatabaseSync } from 'node:sqlite';

import { APP_MIGRATIONS } from '../../lib/core/db/migrations';
import { sqliteD1 } from '../../lib/core/db/sqlite-d1';

let raw: DatabaseSync;

/** A database just before the migration, with a section and a feed in it. */
beforeEach(() => {
  raw = sqliteD1(
    ...APP_MIGRATIONS.filter((file) => file < '0020_folder_parity.sql'),
  ).raw;
  raw.exec(
    "INSERT INTO sections (id, user_id, name) VALUES (1, 1, 'Tech');" +
      'INSERT INTO subscriptions (id, user_id, source_id, section_id) VALUES (1, 1, 1, 1);',
  );
  raw.exec(
    readFileSync(
      path.join(process.cwd(), 'migrations', '0020_folder_parity.sql'),
      'utf8',
    ),
  );
});

describe('0020_folder_parity.sql', () => {
  it('leaves existing sections and feeds with no icon, inheriting the days', () => {
    expect(
      raw.prepare('SELECT icon, auto_mark_read_days FROM sections').get(),
    ).toEqual({ icon: null, auto_mark_read_days: null });
    expect(
      raw
        .prepare('SELECT custom_icon, auto_mark_read_days FROM subscriptions')
        .get(),
    ).toEqual({ custom_icon: null, auto_mark_read_days: null });
  });

  it('files a feed in a section at most once beyond its own', () => {
    const insert = raw.prepare(
      'INSERT INTO subscription_sections (subscription_id, section_id) VALUES (1, 2)',
    );
    insert.run();
    expect(() => insert.run()).toThrow(/UNIQUE|PRIMARY/);
  });
});
