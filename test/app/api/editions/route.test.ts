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

const { POST } = await import('@/app/api/editions/route');

let restore: () => void;
let db: Database;
let auth: Record<string, string>;
let theirs: number;

beforeEach(async () => {
  const made = sqliteD1(...APP_MIGRATIONS);
  restore = installCloudflareContext(made.d1, { SESSION_SECRET });
  made.raw
    .prepare(
      'INSERT INTO users (id, google_sub, email, session_epoch) VALUES (7, ?, ?, 0), (8, ?, ?, 0)',
    )
    .run('g7', 'a@b.com', 'g8', 'b@b.com');
  db = databaseFrom(made.d1);
  theirs = (await new Repository(db).addSection(8, 'Theirs')).id;
  auth = {
    cookie: `${SESSION_COOKIE}=${await tokenFor({ id: 7 }, { ep: 0 })}`,
  };
});

afterEach(() => restore());

const post = (body: string, headers = {}) =>
  POST(
    new Request('https://app.test/api/editions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth, ...headers },
      body,
    }),
  );

const editions = () => new Repository(db).listCustomEditions(7);

describe('POST /api/editions', () => {
  it('answers 201 with the new edition and where to find it', async () => {
    const mine = (await new Repository(db).addSection(7, 'Tech')).id;
    const res = await post(
      JSON.stringify({
        name: 'Weekend',
        section_ids: [String(mine)],
        query: 'rust',
      }),
    );
    expect(res.status).toBe(201);
    const edition = (await res.json()) as { id: string };
    expect(edition).toMatchObject({
      name: 'Weekend',
      section_ids: [String(mine)],
      query: 'rust',
    });
    expect(res.headers.get('location')).toBe(
      `https://app.test/api/editions/${edition.id}`,
    );
  });

  it('answers 400 as a problem naming the missing name', async () => {
    const res = await post('{}');
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    expect(((await res.json()) as { errors: string[] }).errors).toEqual([
      'name: required.',
    ]);
  });

  it('answers 400 for a section that is not the caller’s, storing nothing', async () => {
    const res = await post(
      JSON.stringify({ name: 'Spy', section_ids: [String(theirs)] }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { errors: string[] }).errors).toEqual([
      `section_ids: no section ${theirs}.`,
    ]);
    expect(await editions()).toHaveLength(0);
  });

  it('answers 415 for a body that is not JSON', async () => {
    expect(
      (await post('name=x', { 'Content-Type': 'text/plain' })).status,
    ).toBe(415);
  });

  it('answers 401 when nobody is signed in, storing nothing', async () => {
    auth = {};
    expect((await post('{"name":"Weekend"}')).status).toBe(401);
    expect(await editions()).toHaveLength(0);
  });
});
