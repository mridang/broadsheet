import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { databaseFrom } from '@/domain/db/client';
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

const { GET } = await import('@/app/api/conversations/suggestions/route');

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

const list = () =>
  GET(
    new Request('https://app.test/api/conversations/suggestions', {
      headers: auth,
    }),
  );

describe('GET /api/conversations/suggestions', () => {
  it('answers 200 with starter questions from the person’s saves', async () => {
    const { source_id } = (await repo.addFeed(7, 'https://a.test/f'))!;
    await repo.writeEdition(source_id, '2026-10-20', [
      {
        url: 'https://x/1',
        title: 'One',
        source: 'x',
        favicon: '',
        summary: '',
        image: '',
        published_at: '',
        points: 0,
      },
    ]);
    const [a] = await repo.sourceArticles(source_id, '2026-10-20');
    await repo.saveArticle(7, a!.id, ['rust']);
    const res = await list();
    expect(res.status).toBe(200);
    expect(((await res.json()) as { items: string[] }).items).toContain(
      'Summarise what I saved under "rust"',
    );
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    const res = await list();
    expect(res.status).toBe(401);
  });
});
