import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from '@jest/globals';
import type { DatabaseSync } from 'node:sqlite';

import { APP_MIGRATIONS } from '../../lib/core/db/migrations';
import { sqliteD1 } from '../../lib/core/db/sqlite-d1';

const FILE = '0035_counters_and_indexes.sql';

/** The numbers a source holds against the rows they summarise. */
function counters(raw: DatabaseSync, id: number) {
  return {
    held: raw
      .prepare(
        'SELECT follower_count f, story_count s FROM sources WHERE id = ?',
      )
      .get(id),
    counted: raw
      .prepare(
        `SELECT (SELECT count(*) FROM subscriptions WHERE source_id = $id) f,
                (SELECT count(DISTINCT url) FROM articles WHERE source_id = $id) s`,
      )
      .get({ id }),
  };
}

describe('0035_counters_and_indexes.sql backfill', () => {
  it('fills the counters of the sources that already have rows', () => {
    const raw = sqliteD1(...APP_MIGRATIONS.filter((f) => f < FILE)).raw;
    raw.exec(
      `INSERT INTO sources (id, url) VALUES (1, 'a'), (2, 'b');
       INSERT INTO subscriptions (user_id, source_id) VALUES (1, 1), (2, 1);
       INSERT INTO articles (source_id, url, edition) VALUES
         (1, 'u1', '2026-10-01'), (1, 'u1', '2026-10-02'), (1, 'u2', '2026-10-02');`,
    );
    raw.exec(
      readFileSync(path.join(process.cwd(), 'migrations', FILE), 'utf8'),
    );
    expect(counters(raw, 1).held).toEqual({ f: 2, s: 2 });
    expect(counters(raw, 2).held).toEqual({ f: 0, s: 0 });
  });
});

describe('the counters of a source', () => {
  let raw: DatabaseSync;
  beforeEach(() => {
    raw = sqliteD1(...APP_MIGRATIONS).raw;
    raw.exec("INSERT INTO sources (id, url) VALUES (1, 'a'), (2, 'b')");
  });

  it('follow the subscriptions that come, move and go', () => {
    raw.exec(
      'INSERT INTO subscriptions (id, user_id, source_id) VALUES (1, 1, 1), (2, 2, 1), (3, 3, 2)',
    );
    expect(counters(raw, 1).held).toEqual({ f: 2, s: 0 });
    raw.exec('UPDATE subscriptions SET source_id = 2 WHERE id = 2');
    expect(counters(raw, 1).held).toEqual({ f: 1, s: 0 });
    expect(counters(raw, 2).held).toEqual({ f: 2, s: 0 });
    raw.exec('UPDATE subscriptions SET position = 4 WHERE id = 1');
    raw.exec('DELETE FROM subscriptions WHERE user_id = 3');
    expect(counters(raw, 1).held).toEqual({ f: 1, s: 0 });
    expect(counters(raw, 2).held).toEqual({ f: 1, s: 0 });
  });

  it('count a story address once however many editions carry it', () => {
    raw.exec(
      `INSERT INTO articles (id, source_id, url, edition) VALUES
         (1, 1, 'u1', '2026-10-01'), (2, 1, 'u1', '2026-10-02'), (3, 1, 'u2', '2026-10-02')`,
    );
    expect(counters(raw, 1).held).toEqual({ f: 0, s: 2 });
    raw.exec('DELETE FROM articles WHERE id = 1');
    expect(counters(raw, 1).held).toEqual({ f: 0, s: 2 });
    raw.exec('DELETE FROM articles WHERE id = 2');
    expect(counters(raw, 1).held).toEqual({ f: 0, s: 1 });
  });

  it('stay equal to the rows through a mixed run of writes', () => {
    let seed = 7;
    const next = (n: number) => (seed = (seed * 48271) % 2147483647) % n;
    for (let i = 0; i < 400; i += 1) {
      const source = 1 + next(2);
      const url = `u${next(6)}`;
      const edition = `2026-10-0${1 + next(3)}`;
      const action = next(5);
      if (action < 2) {
        raw.exec(
          `INSERT OR IGNORE INTO articles (source_id, url, edition) VALUES (${source}, '${url}', '${edition}')`,
        );
      } else if (action === 2) {
        raw.exec(
          `DELETE FROM articles WHERE source_id = ${source} AND url = '${url}' AND edition = '${edition}'`,
        );
      } else if (action === 3) {
        raw.exec(
          `UPDATE OR IGNORE articles SET url = 'r${next(3)}' WHERE source_id = ${source} AND url = '${url}' AND edition = '${edition}'`,
        );
      } else {
        raw.exec(
          `INSERT OR IGNORE INTO subscriptions (user_id, source_id) VALUES (${next(5)}, ${source})`,
        );
        raw.exec(
          `UPDATE OR IGNORE subscriptions SET source_id = ${source} WHERE user_id = ${next(5)} AND source_id = ${3 - source}`,
        );
      }
    }
    [1, 2].forEach((id) => {
      const { held, counted } = counters(raw, id);
      expect(held).toEqual(counted);
    });
    expect(counters(raw, 1).counted).not.toEqual({ f: 0, s: 0 });
  });
});

describe('the full-text trigger on articles', () => {
  const rows = (raw: DatabaseSync, word: string) =>
    raw
      .prepare('SELECT rowid FROM articles_fts WHERE articles_fts MATCH ?')
      .all(word)
      .map((r) => r['rowid']);

  it('reindexes a story whose text changed and finds it by the new words only', () => {
    const raw = sqliteD1(...APP_MIGRATIONS).raw;
    raw.exec(
      "INSERT INTO articles (id, source_id, url, title) VALUES (1, 1, 'u', 'alpha')",
    );
    raw.exec("UPDATE articles SET title = 'beta' WHERE id = 1");
    expect(rows(raw, 'alpha')).toEqual([]);
    expect(rows(raw, 'beta')).toEqual([1]);
  });

  it('leaves the index alone when only the cluster or the fetch time changed', () => {
    const raw = sqliteD1(...APP_MIGRATIONS).raw;
    raw.exec(
      "INSERT INTO articles (id, source_id, url, title) VALUES (1, 1, 'u', 'alpha')",
    );
    const before = Number(raw.prepare('SELECT total_changes() n').get()!['n']);
    raw.exec(
      "UPDATE articles SET cluster_id = 3, fetched_at = '2030-01-01' WHERE id = 1",
    );
    const after = Number(raw.prepare('SELECT total_changes() n').get()!['n']);
    expect(after - before).toBe(1);
    expect(rows(raw, 'alpha')).toEqual([1]);
  });
});
