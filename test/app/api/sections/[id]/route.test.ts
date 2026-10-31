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

const { PATCH, DELETE } = await import('@/app/api/sections/[id]/route');

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
  mine = (await new Repository(db).addSection(7, 'Tech')).id;
  auth = await cookieFor(7);
});

afterEach(() => restore());

const sections = () => new Repository(db).listSections(7);

const patch = (id: string | number, body: string, headers = {}) =>
  PATCH(
    new Request(`https://app.test/api/sections/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth, ...headers },
      body,
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );

const remove = (id: string | number) =>
  DELETE(
    new Request(`https://app.test/api/sections/${id}`, {
      method: 'DELETE',
      headers: { ...auth },
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );

describe('PATCH /api/sections/:id', () => {
  it('answers 200 with the renamed, moved section', async () => {
    const res = await patch(
      mine,
      JSON.stringify({ name: 'Science', position: 3 }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: 'Science', position: 3 });
  });

  it('answers 400 as a problem naming the bad field', async () => {
    const res = await patch(mine, JSON.stringify({ name: '' }));
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });

  it('answers 415 for a body that is not JSON', async () => {
    expect(
      (await patch(mine, 'x', { 'Content-Type': 'text/plain' })).status,
    ).toBe(415);
  });

  it('answers 404, changing nothing, for another person’s section', async () => {
    auth = await cookieFor(8);
    expect((await patch(mine, '{"name":"Q"}')).status).toBe(404);
    expect((await sections())[0]?.name).toBe('Tech');
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    expect((await patch(mine, '{"name":"Q"}')).status).toBe(401);
  });
});

describe('DELETE /api/sections/:id', () => {
  it('answers 204 and the section is gone', async () => {
    const res = await remove(mine);
    expect(res.status).toBe(204);
    expect(await sections()).toHaveLength(0);
  });

  it('answers 404 as a problem the second time', async () => {
    await remove(mine);
    const res = await remove(mine);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });

  it.each(['abc', '0', '-1'])(
    'answers 404 for %j, which cannot name a section',
    async (id) => {
      expect((await remove(id)).status).toBe(404);
    },
  );

  it('answers 404, removing nothing, for another person’s section', async () => {
    auth = await cookieFor(8);
    expect((await remove(mine)).status).toBe(404);
    expect(await sections()).toHaveLength(1);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    expect((await remove(mine)).status).toBe(401);
  });
});
