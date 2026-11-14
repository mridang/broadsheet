import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { createDatabase, type Database } from '@/domain/db/client';
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

const { PATCH, DELETE } = await import('@/app/api/editions/[id]/route');

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
  db = createDatabase(made.d1);
  const created = await new Repository(db).addCustomEdition(7, {
    name: 'Weekend',
  });
  mine = created.id;
  auth = await cookieFor(7);
});

afterEach(() => restore());

const edition = () => new Repository(db).getCustomEdition(7, mine);

const patch = (id: string | number, body: string) =>
  PATCH(
    new Request(`https://app.test/api/editions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...auth },
      body,
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );

const remove = (id: string | number) =>
  DELETE(
    new Request(`https://app.test/api/editions/${id}`, {
      method: 'DELETE',
      headers: { ...auth },
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );

describe('PATCH /api/editions/:id', () => {
  it('answers 200 with the edition as it is now', async () => {
    const res = await patch(mine, '{"name":"Sunday","tag":"long"}');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: 'Sunday', tag: 'long' });
  });

  it('answers 400 for a section that is not the caller’s', async () => {
    const section = await new Repository(db).addSection(8, 'Theirs');
    const theirs = section.id;
    const res = await patch(
      mine,
      JSON.stringify({ section_ids: [`${theirs}`] }),
    );
    expect(res.status).toBe(400);
    const saved = await edition();
    expect(saved?.section_ids).toEqual([]);
  });

  it('answers 404 for another person’s edition, changing nothing', async () => {
    auth = await cookieFor(8);
    const res = await patch(mine, '{"name":"Taken"}');
    expect(res.status).toBe(404);
    const saved = await edition();
    expect(saved?.name).toBe('Weekend');
  });

  it('answers 404 for self, which no custom edition can be', async () => {
    const res = await patch('self', '{"name":"Taken"}');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    const res = await patch(mine, '{"name":"x"}');
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/editions/:id', () => {
  it('answers 204 and removes the edition', async () => {
    const res = await remove(mine);
    expect(res.status).toBe(204);
    expect(await edition()).toBeUndefined();
  });

  it('answers 404 for another person’s edition, keeping it', async () => {
    auth = await cookieFor(8);
    const res = await remove(mine);
    expect(res.status).toBe(404);
    expect(await edition()).toBeDefined();
  });

  it('answers 404 for self', async () => {
    const res = await remove('self');
    expect(res.status).toBe(404);
  });
});
