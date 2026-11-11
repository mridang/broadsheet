import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { databaseFrom, type Database } from '@/domain/db/database';
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

const { POST } = await import('@/app/api/users/self/tokens/route');

let restore: () => void;
let db: Database;
let auth: Record<string, string>;

beforeEach(async () => {
  const made = sqliteD1(...APP_MIGRATIONS);
  restore = installCloudflareContext(made.d1, { SESSION_SECRET });
  made.raw
    .prepare(
      'INSERT INTO users (id, google_sub, email, session_epoch) VALUES (7, ?, ?, 0), (8, ?, ?, 0)',
    )
    .run('g7', 'a@b.com', 'g8', 'b@b.com');
  db = databaseFrom(made.d1);
  auth = {
    cookie: `${SESSION_COOKIE}=${await tokenFor({ id: 7 }, { ep: 0 })}`,
  };
});

afterEach(() => restore());

const post = (body: unknown) =>
  POST(
    new Request('https://app.test/api/users/self/tokens', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify(body),
    }),
  );

describe('POST /api/users/self/tokens', () => {
  it('answers 201 with a token that follows one of the person’s saved searches', async () => {
    const { search } = await new Repository(db).addSearch(7, 'rust', null);
    const res = await post({ scope: 'search', search_id: String(search.id) });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      scope: 'search',
      search_id: String(search.id),
      feed_url: expect.stringContaining('/feed.xml?token='),
    });
  });

  it('answers 400 for someone else’s saved search', async () => {
    const { search } = await new Repository(db).addSearch(8, 'rust', null);
    const res = await post({ scope: 'search', search_id: String(search.id) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { errors: string[] }).errors).toEqual([
      'search_id: must name one of your saved searches.',
    ]);
  });

  it('answers 400 for a section that is not the person’s', async () => {
    const section = await new Repository(db).addSection(8, 'Tech');
    const res = await post({
      scope: 'section',
      section_id: String(section.id),
    });
    expect(res.status).toBe(400);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    const res = await post({ scope: 'edition' });
    expect(res.status).toBe(401);
  });
});
