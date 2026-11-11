import { beforeEach, describe, expect, it } from '@jest/globals';

import { databaseFrom } from '@/domain/db/database';
import { FeedImportRuns } from '@/domain/feed-import-runs';
import { Repository } from '@/domain/repository';
import { APP_MIGRATIONS } from '../lib/core/db/migrations';
import { sqliteD1 } from '../lib/core/db/sqlite-d1';
// eslint-disable-next-line n/no-unsupported-features/node-builtins -- experimental API used on purpose
import type { DatabaseSync } from 'node:sqlite';

let runs: FeedImportRuns;
let repo: Repository;
let raw: DatabaseSync;

beforeEach(() => {
  const made = sqliteD1(...APP_MIGRATIONS);
  raw = made.raw;
  const db = databaseFrom(made.d1);
  runs = new FeedImportRuns(db);
  repo = new Repository(db);
});

describe('FeedImportRuns', () => {
  it('starts an import running with nothing done', async () => {
    const run = await runs.start(7, 120);
    expect(await runs.get(7, run.id)).toEqual({
      id: run.id,
      status: 'running',
      total: 120,
      processed: 0,
      added: 0,
      skipped: 0,
      sections_added: 0,
      rejected: [],
    });
  });

  it('keeps an import from anyone else', async () => {
    const run = await runs.start(7, 1);
    expect(await runs.get(8, run.id)).toBeUndefined();
  });

  it('adds what each chunk did to the import', async () => {
    await repo.addFeed(7, 'https://a.test/old');
    const run = await runs.start(7, 4);
    const fetched = await runs.importChunk(run.id, 7, [
      { url: 'https://a.test/1', sections: ['Tech'] },
      { url: 'https://a.test/old' },
    ]);
    await runs.importChunk(run.id, 7, [
      { url: 'javascript:x' },
      { url: 'https://a.test/2' },
    ]);
    expect(fetched.map((f) => f.url)).toEqual(['https://a.test/1']);
    expect(await runs.get(7, run.id)).toMatchObject({
      status: 'running',
      processed: 4,
      added: 2,
      skipped: 1,
      sections_added: 1,
      rejected: [
        {
          url: 'javascript:x',
          reason: 'url: must be an http or https address.',
        },
      ],
    });
  });

  it('marks an import finished', async () => {
    const run = await runs.start(7, 1);
    await runs.finish(run.id, 'failed');
    const found = await runs.get(7, run.id);
    expect(found?.status).toBe('failed');
  });

  it('purges only the imports that finished before the cut-off', async () => {
    const old = await runs.start(7, 1);
    const recent = await runs.start(7, 1);
    const running = await runs.start(7, 1);
    raw
      .prepare('UPDATE feed_imports SET finished_at = ? WHERE id = ?')
      .run('2026-10-01 00:00:00', old.id);
    raw
      .prepare('UPDATE feed_imports SET finished_at = ? WHERE id = ?')
      .run('2026-10-30 00:00:00', recent.id);
    expect(await runs.purgeFinished(new Date('2026-10-25T00:00:00Z'))).toBe(1);
    expect(await runs.get(7, old.id)).toBeUndefined();
    expect(await runs.get(7, recent.id)).toBeDefined();
    expect(await runs.get(7, running.id)).toBeDefined();
  });
});
