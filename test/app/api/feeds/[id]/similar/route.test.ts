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

  it('pages five at a time with a cursor', async () => {
    const mine = (await repo.addFeed(7, 'https://shared.test/f'))!;
    await repo.addFeed(8, 'https://shared.test/f');
    for (let i = 0; i < 6; i++)
      await repo.addFeed(8, `https://extra${i}.test/f`);
    const listed = await similar(mine.id);
    const first = (await listed.json()) as {
      next?: string;
      items: unknown[];
    };
    expect(first.items).toHaveLength(5);
    const cursor = new URL(first.next!).searchParams.get('cursor')!;
    const secondPage = await GET(
      new Request(
        `https://app.test/api/feeds/${mine.id}/similar?cursor=${cursor}`,
        { headers: auth },
      ),
      { params: Promise.resolve({ id: String(mine.id) }) },
    );
    const second = (await secondPage.json()) as {
      next?: string;
      items: unknown[];
    };
    expect([second.items.length, second.next]).toEqual([1, undefined]);
  });

  it('answers 400 for a bad cursor', async () => {
    const mine = (await repo.addFeed(7, 'https://shared.test/f'))!;
    const res = await GET(
      new Request(`https://app.test/api/feeds/${mine.id}/similar?cursor=x`, {
        headers: auth,
      }),
      { params: Promise.resolve({ id: String(mine.id) }) },
    );
    expect(res.status).toBe(400);
  });

  it.each(['999', 'abc'])('answers 404 for feed %j', async (id) => {
    const res = await similar(id);
    expect(res.status).toBe(404);
  });

  it('answers 404 for another person’s feed', async () => {
    const theirs = (await repo.addFeed(8, 'https://shared.test/f'))!;
    const res = await similar(theirs.id);
    expect(res.status).toBe(404);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    const res = await similar(1);
    expect(res.status).toBe(401);
  });
});
