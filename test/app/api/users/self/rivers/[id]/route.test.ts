import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { databaseFrom, type Database } from '@/domain/db/database';
import { RiverRepository } from '@/domain/rivers';
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

const { DELETE } = await import('@/app/api/users/self/rivers/[id]/route');

let restore: () => void;
let db: Database;
let mine: number;
let auth: Record<string, string>;

async function cookieFor(uid: number): Promise<Record<string, string>> {
  return {
    cookie: `${SESSION_COOKIE}=${await tokenFor({ id: uid }, { ep: 0 })}`,
  };
}

beforeEach(async () => {
  const made = sqliteD1(...APP_MIGRATIONS);
  restore = installCloudflareContext(made.d1, { SESSION_SECRET });
  made.raw
    .prepare(
      'INSERT INTO users (id, google_sub, email, session_epoch) VALUES (7, ?, ?, 0), (8, ?, ?, 0)',
    )
    .run('g7', 'a@b.com', 'g8', 'b@b.com');
  db = databaseFrom(made.d1);
  const [top] = await new RiverRepository(db).replace(7, [
    { river_id: 'all', side: 'left', position: 0 },
    { river_id: 'saves', side: 'left', position: 1 },
  ]);
  mine = top!.id;
  auth = await cookieFor(7);
});

afterEach(() => restore());

const remove = (id: string | number) =>
  DELETE(
    new Request(`https://app.test/api/users/self/rivers/${id}`, {
      method: 'DELETE',
      headers: { ...auth },
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );

describe('DELETE /api/users/self/rivers/:id', () => {
  it('answers 204 and moves the river below it up', async () => {
    expect((await remove(mine)).status).toBe(204);
    expect(await new RiverRepository(db).list(7)).toMatchObject([
      { river_id: 'saves', position: 0 },
    ]);
  });

  it('answers 404 for another person’s river, keeping it', async () => {
    auth = await cookieFor(8);
    expect((await remove(mine)).status).toBe(404);
    expect(await new RiverRepository(db).list(7)).toHaveLength(2);
  });

  it('answers 404 for an id that cannot name a river', async () => {
    expect((await remove('self')).status).toBe(404);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    expect((await remove(mine)).status).toBe(401);
  });
});
