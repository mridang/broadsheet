import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { createDatabase, type Database } from '@/domain/db/client';
import { Repository } from '@/domain/repository';
import { SESSION_COOKIE } from '@/domain/auth/app';
import { APP_MIGRATIONS } from '../../../../../../lib/core/db/migrations';
import {
  installCloudflareContext,
  sqliteD1,
} from '../../../../../../lib/core/db/sqlite-d1';
import {
  SESSION_SECRET,
  tokenFor,
} from '../../../../../../domain/auth/auth-test-kit';

const { GET } = await import('@/app/api/editions/self/issues/[date]/route');

let restore: () => void;
let db: Database;
let auth: Record<string, string>;

const DAY = '2026-11-01';

/** Person 7 has a stored issue whose one story has a copy, article 42. */
beforeEach(async () => {
  const made = sqliteD1(...APP_MIGRATIONS);
  restore = installCloudflareContext(made.d1, { SESSION_SECRET });
  made.raw
    .prepare(
      'INSERT INTO users (id, google_sub, email, session_epoch) VALUES (7, ?, ?, 0)',
    )
    .run('g7', 'a@b.com');
  db = createDatabase(made.d1);
  await new Repository(db).saveIssue(
    7,
    DAY,
    JSON.stringify({
      groups: [
        {
          name: null,
          desks: [
            {
              feed_id: 1,
              title: 'A',
              url: 'https://a.test/f',
              stories: [
                {
                  id: 41,
                  tier: 'lead',
                  also: ['B'],
                  siblings: [
                    {
                      id: 42,
                      source: 'B',
                      url: 'https://b.test/42',
                      tier: 'title',
                      title: 'Rust ships',
                      image: 'https://img.test/42.jpg',
                      excerpt: 'Opening.',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }),
    'Note.',
  );
  auth = {
    cookie: `${SESSION_COOKIE}=${await tokenFor({ id: 7 }, { ep: 0 })}`,
  };
});

afterEach(() => restore());

const get = (date: string) =>
  GET(
    new Request(`https://app.test/api/editions/self/issues/${date}`, {
      headers: { ...auth },
    }),
    { params: Promise.resolve({ date }) },
  );

type Copy = Record<string, unknown>;
const copyOf = async (res: Response): Promise<Copy> => {
  const body = (await res.json()) as {
    sections: { desks: { stories: { covered_by: Copy[] }[] }[] }[];
  };
  return body.sections[0]!.desks[0]!.stories[0]!.covered_by[0]!;
};

describe('GET /api/editions/self/issues/:date', () => {
  it('answers 200 with each copy unread and untrained, in one line', async () => {
    const res = await get(DAY);
    expect(res.status).toBe(200);
    const copy = await copyOf(res);
    expect(copy).toMatchObject({
      article_id: '42',
      match: 'title',
      title: 'Rust ships',
      read: false,
      score: 0,
    });
    expect(copy).not.toHaveProperty('image');
  });

  it('marks a copy the person trained the paper on', async () => {
    await new Repository(db).addClassifier(7, {
      kind: 'title',
      value: 'rust',
      score: 1,
    });
    const copy = await copyOf(await get(DAY));
    expect(copy['score']).toBe(1);
  });

  it('shows the picture and opening with the expanded preview', async () => {
    await new Repository(db).updatePreferences(7, {
      cluster_preview_style: 'expanded',
    });
    expect(await copyOf(await get(DAY))).toMatchObject({
      image: 'https://img.test/42.jpg',
      excerpt: 'Opening.',
    });
  });

  it.each(['2026-10-31', '2026-02-30', 'latest'])(
    'answers 404 for %s',
    async (date) => {
      const res = await get(date);
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toBe('application/problem+json');
    },
  );

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    const res = await get(DAY);
    expect(res.status).toBe(401);
  });
});
