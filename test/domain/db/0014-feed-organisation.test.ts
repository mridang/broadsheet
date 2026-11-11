import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it } from '@jest/globals';

import type { DatabaseSync } from 'node:sqlite';

import { APP_MIGRATIONS } from '../../lib/core/db/migrations';
import { sqliteD1 } from '../../lib/core/db/sqlite-d1';

let raw: DatabaseSync;

/** A database just before the migration, with a section and a feed in it. */
beforeEach(async () => {
  raw = sqliteD1(
    ...APP_MIGRATIONS.filter(
      (file) => file.localeCompare('0014_feed_organisation.sql') < 0,
    ),
  ).raw;
  raw.exec(
    "INSERT INTO sources (id, url) VALUES (1, 'https://a.test/f');" +
      "INSERT INTO sections (id, user_id, name) VALUES (1, 1, 'Tech');" +
      'INSERT INTO subscriptions (id, user_id, source_id, section_id, muted) VALUES (1, 1, 1, 1, 1);',
  );
  raw.exec(
    await readFile(
      path.join(process.cwd(), 'migrations', '0014_feed_organisation.sql'),
      'utf8',
    ),
  );
});

describe('0014_feed_organisation.sql', () => {
  it('leaves existing sections at the top level', () => {
    expect(raw.prepare('SELECT parent_id FROM sections').get()).toEqual({
      parent_id: null,
    });
  });

  it('keeps an existing mute for good, first in the order', () => {
    expect(
      raw
        .prepare('SELECT muted, muted_until, position FROM subscriptions')
        .get(),
    ).toEqual({ muted: 1, muted_until: null, position: 0 });
  });
});
