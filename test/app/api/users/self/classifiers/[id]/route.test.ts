import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { createDatabase, type Database } from '@/domain/db/client';
import { Repository } from '@/domain/repository';
import { SESSION_COOKIE } from '@/domain/auth/app';
import { APP_MIGRATIONS } from '../../../../../../lib/core/db/migrations';
import {
  installCloudflareContext,
  sqliteD1,
} from '../../../../../../lib/core/db/sqlite-d1';
import {
  SESSION_SECRET,
  tokenFor,
} from '../../../../../../domain/auth/auth-test-kit';

const { DELETE } = await import('@/app/api/users/self/classifiers/[id]/route');

let restore: () => void;
let db: Database;
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
  db = createDatabase(made.d1);
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
  auth = await cookieFor(7);
});

afterEach(() => restore());

let mine: number;

beforeEach(async () => {
  const added = await new Repository(db).addClassifier(7, {
    kind: 'source',
    value: 'x',
    score: 1,
  });
  mine = added.classifier.id;
});

const remove = (id: string | number) =>
  DELETE(
    new Request(`https://app.test/api/users/self/classifiers/${id}`, {
      method: 'DELETE',
      headers: { ...auth },
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );

const classifiers = () => new Repository(db).listClassifiers(7);

describe('DELETE /api/users/self/classifiers/:id', () => {
  it('answers 204 and the classifier is gone', async () => {
    const res = await remove(mine);
    expect(res.status).toBe(204);
    expect(await classifiers()).toEqual([]);
  });

  it('answers 404 as a problem the second time', async () => {
    await remove(mine);
    const res = await remove(mine);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });

  it.each(['abc', '0', '-1'])(
    'answers 404 for %j, which cannot name a classifier',
    async (id) => {
      const res = await remove(id);
      expect(res.status).toBe(404);
    },
  );

  it('answers 404, removing nothing, for another person’s classifier', async () => {
    auth = await cookieFor(8);
    const res = await remove(mine);
    expect(res.status).toBe(404);
    expect(await classifiers()).toHaveLength(1);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    const res = await remove(mine);
    expect(res.status).toBe(401);
  });
});
