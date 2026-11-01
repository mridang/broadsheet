import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { databaseFrom } from '@/domain/db/database';
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

const { GET } = await import('@/app/api/feeds/[id]/similar/route');

let restore: () => void;
let repo: Repository;
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
  repo = new Repository(databaseFrom(made.d1));
  auth = await cookieFor(7);
});

afterEach(() => restore());

const similar = (id: string | number) =>
  GET(
    new Request(`https://app.test/api/feeds/${id}/similar`, { headers: auth }),
    { params: Promise.resolve({ id: String(id) }) },
  );

describe('GET /api/feeds/:id/similar', () => {
  it('answers 200 with sources followers of the feed also follow', async () => {
    const mine = (await repo.addFeed(7, 'https://shared.test/f'))!;
    await repo.addFeed(8, 'https://shared.test/f');
    await repo.addFeed(8, 'https://extra.test/f');
    const res = await similar(mine.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      items: [{ url: 'https://extra.test/f', followers: 1, stories: [] }],
    });
  });

  it.each(['999', 'abc'])('answers 404 for feed %j', async (id) => {
    expect((await similar(id)).status).toBe(404);
  });

  it('answers 404 for another person’s feed', async () => {
    const theirs = (await repo.addFeed(8, 'https://shared.test/f'))!;
    expect((await similar(theirs.id)).status).toBe(404);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    expect((await similar(1)).status).toBe(401);
  });
});
