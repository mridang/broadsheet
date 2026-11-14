import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { createDatabase } from '@/domain/db/client';
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

const { GET } = await import('@/app/api/feeds/suggestions/route');

let restore: () => void;
let auth: Record<string, string>;

/** Persons 7 and 8 share a source; 8 also follows another. */
beforeEach(async () => {
  const made = sqliteD1(...APP_MIGRATIONS);
  restore = installCloudflareContext(made.d1, { SESSION_SECRET });
  made.raw
    .prepare(
      'INSERT INTO users (id, google_sub, email, session_epoch) VALUES (7, ?, ?, 0), (8, ?, ?, 0)',
    )
    .run('g7', 'a@b.com', 'g8', 'b@b.com');
  const repo = new Repository(createDatabase(made.d1));
  await repo.addFeed(7, 'https://shared.test/f');
  await repo.addFeed(8, 'https://shared.test/f');
  await repo.addFeed(8, 'https://other.test/f');
  auth = {
    cookie: `${SESSION_COOKIE}=${await tokenFor({ id: 7 }, { ep: 0 })}`,
  };
});

afterEach(() => restore());

const list = () =>
  GET(new Request('https://app.test/api/feeds/suggestions', { headers: auth }));

describe('GET /api/feeds/suggestions', () => {
  it('answers 200 with a page of sources the person does not follow', async () => {
    const res = await list();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      self: expect.stringMatching(/\/api\/feeds\/suggestions$/),
      items: [
        {
          url: 'https://other.test/f',
          followers: 1,
        },
      ],
    });
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    const res = await list();
    expect(res.status).toBe(401);
  });
});
