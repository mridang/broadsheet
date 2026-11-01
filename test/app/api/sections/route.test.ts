import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { databaseFrom, type Database } from '@/domain/db/database';
import { Repository } from '@/domain/repository';
import { SESSION_COOKIE } from '@/domain/auth/app';
import { APP_MIGRATIONS } from '../../../lib/core/db/migrations';
import {
  installCloudflareContext,
  sqliteD1,
} from '../../../lib/core/db/sqlite-d1';
import { SESSION_SECRET, tokenFor } from '../../../domain/auth/auth-test-kit';

const { POST } = await import('@/app/api/sections/route');

let restore: () => void;
let db: Database;
let auth: Record<string, string>;

beforeEach(async () => {
  const made = sqliteD1(...APP_MIGRATIONS);
  restore = installCloudflareContext(made.d1, { SESSION_SECRET });
  made.raw
    .prepare(
      'INSERT INTO users (id, google_sub, email, session_epoch) VALUES (7, ?, ?, 0)',
    )
    .run('g7', 'a@b.com');
  db = databaseFrom(made.d1);
  auth = {
    cookie: `${SESSION_COOKIE}=${await tokenFor({ id: 7 }, { ep: 0 })}`,
  };
});

afterEach(() => restore());

const post = (body: string, headers = {}) =>
  POST(
    new Request('https://app.test/api/sections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth, ...headers },
      body,
    }),
  );

describe('POST /api/sections', () => {
  it('answers 201 with the new section and where to find it', async () => {
    const res = await post(JSON.stringify({ name: 'Tech' }));
    expect(res.status).toBe(201);
    const section = (await res.json()) as { id: string };
    expect(section).toMatchObject({ name: 'Tech', position: 0 });
    expect(res.headers.get('location')).toBe(
      `https://app.test/api/sections/${section.id}`,
    );
    expect(await new Repository(db).listSections(7)).toHaveLength(1);
  });

  it('nests a new section under one of the caller’s sections', async () => {
    const parent = await new Repository(db).addSection(7, 'Tech');
    const res = await post(
      JSON.stringify({ name: 'AI', parent_id: String(parent.id) }),
    );
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ parent_id: String(parent.id) });
  });

  it('answers 400 naming parent_id for a parent that is not the caller’s', async () => {
    const res = await post(JSON.stringify({ name: 'AI', parent_id: '999' }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { errors: string[] }).errors[0]).toMatch(
      /^parent_id:/,
    );
    expect(await new Repository(db).listSections(7)).toHaveLength(0);
  });

  it('answers 400 as a problem naming the missing name', async () => {
    const res = await post('{}');
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    expect(((await res.json()) as { errors: string[] }).errors).toEqual([
      'name: required.',
    ]);
  });

  it('answers 415 for a body that is not JSON', async () => {
    expect(
      (await post('name=x', { 'Content-Type': 'text/plain' })).status,
    ).toBe(415);
  });

  it('answers 401 when nobody is signed in, storing nothing', async () => {
    auth = {};
    expect((await post('{"name":"Tech"}')).status).toBe(401);
    expect(await new Repository(db).listSections(7)).toHaveLength(0);
  });
});
