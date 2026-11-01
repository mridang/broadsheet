import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { databaseFrom } from '@/domain/db/database';
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

const { DELETE } = await import('@/app/api/users/self/searches/[id]/route');

let restore: () => void;
let id: number;

beforeEach(async () => {
  const made = sqliteD1(...APP_MIGRATIONS);
  restore = installCloudflareContext(made.d1, { SESSION_SECRET });
  made.raw
    .prepare(
      'INSERT INTO users (id, google_sub, email, session_epoch) VALUES (7, ?, ?, 0), (8, ?, ?, 0)',
    )
    .run('g7', 'a@b.com', 'g8', 'b@b.com');
  id = (await new Repository(databaseFrom(made.d1)).addSearch(7, 'rust', null))
    .search.id;
});

afterEach(() => restore());

const remove = async (path: string, uid?: number) =>
  DELETE(
    new Request(`https://app.test/api/users/self/searches/${path}`, {
      method: 'DELETE',
      headers: uid
        ? {
            cookie: `${SESSION_COOKIE}=${await tokenFor({ id: uid }, { ep: 0 })}`,
          }
        : {},
    }),
    { params: Promise.resolve({ id: path }) },
  );

describe('DELETE /api/users/self/searches/:id', () => {
  it('forgets the search, then answers 404', async () => {
    expect((await remove(String(id), 7)).status).toBe(204);
    expect((await remove(String(id), 7)).status).toBe(404);
  });

  it.each([
    ['someone else’s search', () => String(id), 8],
    ['an id that cannot name one', () => 'abc', 7],
  ])('answers 404 for %s', async (_what, path, uid) => {
    const res = await remove(path(), uid);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });

  it('answers 401 when nobody is signed in', async () => {
    expect((await remove(String(id))).status).toBe(401);
  });
});
