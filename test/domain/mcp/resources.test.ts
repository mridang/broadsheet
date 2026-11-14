import { beforeEach, describe, expect, it } from '@jest/globals';

import { databaseFrom, type Database } from '@/domain/db/client';
import { RESOURCES } from '@/domain/mcp/resources';
import type { ToolContext } from '@/domain/mcp/tool-context';
import type { User } from '@/domain/db/users';
import { Repository } from '@/domain/repository';
import { APP_MIGRATIONS } from '../../lib/core/db/migrations';
import { sqliteD1 } from '../../lib/core/db/sqlite-d1';

let db: Database;
let ctx: ToolContext;

beforeEach(async () => {
  db = databaseFrom(sqliteD1(...APP_MIGRATIONS).d1);
  const repo = new Repository(db);
  await repo.upsertUser({ sub: 'g1', email: 'a@b.com', name: 'A' });
  await repo.upsertUser({ sub: 'g2', email: 'c@d.com' });
  ctx = {
    user: { id: 1 } as User,
    services: { openDatabase: () => db, refresh: () => undefined },
  };
});

/** Read a resource by its URI the way the engine finds it. */
async function read(uri: string) {
  for (const r of RESOURCES) {
    const params = r.uri === uri ? {} : r.match?.(uri);
    if (params) return r.read(params, ctx);
  }
  throw new Error(`no resource at ${uri}`);
}

describe('RESOURCES', () => {
  it('lists the caller’s feeds only', async () => {
    await new Repository(db).addFeed(1, 'https://a.test/f');
    await new Repository(db).addFeed(2, 'https://o.test/f');
    expect(await read('broadsheet://feeds')).toMatchObject({
      feeds: [{ url: 'https://a.test/f' }],
    });
  });

  it('lists sections', async () => {
    await new Repository(db).addSection(1, 'Tech');
    expect(await read('broadsheet://sections')).toMatchObject({
      sections: [{ name: 'Tech' }],
    });
  });

  it('counts saved tags', async () => {
    const repo = new Repository(db);
    const feed = (await repo.addFeed(1, 'https://a.test/f'))!;
    await repo.writeEdition(feed.source_id, '2026-11-01', [
      {
        url: 'https://a.test/1',
        title: 'T',
        source: 'a.test',
        image: '',
        favicon: '',
        summary: '',
        published_at: '',
        points: 0,
      },
    ]);
    const [article] = await repo.searchArticles(1, { limit: 1 });
    await repo.saveArticle(1, article!.id, ['x']);
    expect(await read('broadsheet://saved/tags')).toEqual({
      tags: [{ tag: 'x', count: 1 }],
    });
  });

  it('lists classifiers', async () => {
    await new Repository(db).addClassifier(1, {
      kind: 'title',
      value: 'Go',
      score: 1,
    });
    expect(await read('broadsheet://classifiers')).toMatchObject({
      classifiers: [{ value: 'Go', score: 'like' }],
    });
  });

  it('names the person', async () => {
    expect(await read('broadsheet://profile')).toEqual({
      email: 'a@b.com',
      name: 'A',
    });
  });

  it('reads one feed by its URI', async () => {
    const feed = (await new Repository(db).addFeed(1, 'https://a.test/f'))!;
    expect(await read(`broadsheet://feeds/${feed.id}`)).toMatchObject({
      url: 'https://a.test/f',
      metadata: [],
    });
  });

  it("refuses another person's feed", async () => {
    const feed = (await new Repository(db).addFeed(2, 'https://o.test/f'))!;
    await expect(read(`broadsheet://feeds/${feed.id}`)).rejects.toThrow(
      'There is no such feed.',
    );
  });

  it('matches no malformed feed URI', () => {
    const template = RESOURCES.find((r) => r.uriTemplate)!;
    expect(template.match!('broadsheet://feeds/0')).toBeUndefined();
  });
});
