import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { databaseFrom, type Database } from '@/domain/db/database';
import { Repository } from '@/domain/repository';
import { SESSION_COOKIE } from '@/domain/auth/app';
import { APP_MIGRATIONS } from '../../../../lib/core/db/migrations';
import {
  installCloudflareContext,
  sqliteD1,
} from '../../../../lib/core/db/sqlite-d1';
import {
  SESSION_SECRET,
  tokenFor,
} from '../../../../domain/auth/auth-test-kit';

const { POST } = await import('@/app/api/feeds/moves/route');

let restore: () => void;
let db: Database;
let repo: Repository;
let mine: number;
let theirs: number;
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
  repo = new Repository(db);
  mine = (await repo.addFeed(7, 'https://a.test/f'))!.id;
  theirs = (await repo.addFeed(8, 'https://b.test/f'))!.id;
  auth = await cookieFor(7);
});

afterEach(() => restore());

const post = (body: string, headers = {}) =>
  POST(
    new Request('https://app.test/api/feeds/moves', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth, ...headers },
      body,
    }),
  );

const errors = async (res: Response) =>
  ((await res.json()) as { errors: string[] }).errors;

describe('POST /api/feeds/moves', () => {
  it('files the caller’s feeds under the section, skipping others’, and counts them', async () => {
    const section = await repo.addSection(7, 'Tech');
    const res = await post(
      JSON.stringify({
        feed_ids: [String(mine), String(theirs)],
        section_id: String(section.id),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ moved: 1 });
    expect((await repo.getFeed(7, mine))?.section_id).toBe(section.id);
    expect((await repo.getFeed(8, theirs))?.section_id).toBeNull();
  });

  it('takes feeds out of every section with a null section', async () => {
    const section = await repo.addSection(7, 'Tech');
    await repo.updateFeed(7, mine, { section_id: section.id });
    await post(JSON.stringify({ feed_ids: [String(mine)], section_id: null }));
    expect((await repo.getFeed(7, mine))?.section_id).toBeNull();
  });

  it('answers 400 naming section_id for another person’s section', async () => {
    const section = await repo.addSection(8, 'Theirs');
    const res = await post(
      JSON.stringify({
        feed_ids: [String(mine)],
        section_id: String(section.id),
      }),
    );
    expect(res.status).toBe(400);
    expect(await errors(res)).toEqual(['section_id: no such section.']);
  });

  it.each([
    [
      { feed_ids: [], section_id: null },
      'feed_ids: a list of 1 to 500 feed ids.',
    ],
    [
      { feed_ids: [1], section_id: null },
      'feed_ids: a list of 1 to 500 feed ids.',
    ],
    [{ feed_ids: ['1'] }, 'section_id: a section id, or null for none.'],
    [
      { feed_ids: ['1'], section_id: null, to: 'x' },
      'to: not a member of a move.',
    ],
  ])('answers 400 as a problem for %j', async (body, error) => {
    const res = await post(JSON.stringify(body));
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    expect(await errors(res)).toEqual([error]);
  });

  it('answers 415 for a body that is not JSON', async () => {
    expect((await post('x', { 'Content-Type': 'text/plain' })).status).toBe(
      415,
    );
  });

  it('answers 401 when nobody is signed in, moving nothing', async () => {
    auth = {};
    const section = await repo.addSection(7, 'Tech');
    const res = await post(
      JSON.stringify({
        feed_ids: [String(mine)],
        section_id: String(section.id),
      }),
    );
    expect(res.status).toBe(401);
    expect((await repo.getFeed(7, mine))?.section_id).toBeNull();
  });
});
