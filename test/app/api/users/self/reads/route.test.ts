import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { databaseFrom, type Database } from '@/domain/db/database';
import { Repository } from '@/domain/repository';
import { SESSION_COOKIE } from '@/domain/auth/app';
import { APP_MIGRATIONS } from '../../../../../lib/core/db/migrations';
import {
  installCloudflareContext,
  sqliteD1,
} from '../../../../../lib/core/db/sqlite-d1';
import {
  SESSION_SECRET,
  tokenFor,
} from '../../../../../domain/auth/auth-test-kit';

const { POST } = await import('@/app/api/users/self/reads/route');

let restore: () => void;
let db: Database;
let story: number;
let auth: Record<string, string>;

async function cookieFor(uid: number): Promise<Record<string, string>> {
  return {
    cookie: `${SESSION_COOKIE}=${await tokenFor({ id: uid }, { ep: 0 })}`,
  };
}

/** Two people; person 7 follows a source with one story. */
beforeEach(async () => {
  const made = sqliteD1(...APP_MIGRATIONS);
  restore = installCloudflareContext(made.d1, { SESSION_SECRET });
  made.raw
    .prepare(
      'INSERT INTO users (id, google_sub, email, session_epoch) VALUES (7, ?, ?, 0), (8, ?, ?, 0)',
    )
    .run('g7', 'a@b.com', 'g8', 'b@b.com');
  db = databaseFrom(made.d1);
  const repo = new Repository(db);
  const { source_id } = (await repo.addFeed(7, 'https://a.test/f'))!;
  await repo.writeEdition(source_id, '2026-10-20', [
    {
      url: 'https://x/1',
      title: 'One',
      source: 'x',
      favicon: '',
      summary: '',
      image: '',
      published_at: '',
      points: 0,
    },
  ]);
  story = (await repo.sourceArticles(source_id, '2026-10-20'))[0]!.id;
  auth = await cookieFor(7);
});

afterEach(() => restore());

const readMany = (body: unknown) =>
  POST(
    new Request('https://app.test/api/users/self/reads', {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) },
  );

describe('POST /api/users/self/reads', () => {
  it('answers 200 with the stories it noted, leaving out unknown ones', async () => {
    const res = await readMany({ article_ids: [String(story), '999'] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      items: [{ article_id: String(story) }],
    });
  });

  it('notes the stories as read', async () => {
    await readMany({ article_ids: [String(story)] });
    expect([...(await new Repository(db).readState(7)).ids]).toEqual([story]);
  });

  it.each([{}, { article_ids: [] }, { article_ids: [1] }])(
    'answers 400 for %j',
    async (body) => {
      expect((await readMany(body)).status).toBe(400);
    },
  );

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    expect((await readMany({ article_ids: [String(story)] })).status).toBe(401);
  });
});

describe('POST /api/users/self/reads with copies', () => {
  it('marks the other copies read when the person asked for that', async () => {
    const repo = new Repository(db);
    const { source_id } = (await repo.addFeed(7, 'https://b.test/f'))!;
    await repo.writeEdition(source_id, '2026-10-20', [
      {
        url: 'https://y/1',
        title: 'One',
        source: 'y',
        favicon: '',
        summary: '',
        image: '',
        published_at: '',
        points: 0,
      },
    ]);
    const copy = (await repo.sourceArticles(source_id, '2026-10-20'))[0]!.id;
    await repo.writeClusters('2026-10-20', [[story, copy]]);
    await repo.updatePreferences(7, { cluster_mark_read: true });
    await readMany({ article_ids: [String(story)] });
    expect([...(await repo.readState(7)).ids].toSorted()).toEqual(
      [story, copy].toSorted(),
    );
  });
});
