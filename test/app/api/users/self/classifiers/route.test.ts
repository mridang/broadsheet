import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { createDatabase, type Database } from '@/domain/db/client';
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

const { GET, POST } = await import('@/app/api/users/self/classifiers/route');

let restore: () => void;
let db: Database;
let auth: Record<string, string>;

async function cookieFor(uid: number): Promise<Record<string, string>> {
  return {
    cookie: `${SESSION_COOKIE}=${await tokenFor({ id: uid }, { ep: 0 })}`,
  };
}

/** Two people; person 7 follows a source with one story. */
beforeEach(async () => {
  const made = sqliteD1(...APP_MIGRATIONS);
  restore = installCloudflareContext(made.d1, { SESSION_SECRET });
  made.raw
    .prepare(
      'INSERT INTO users (id, google_sub, email, session_epoch) VALUES (7, ?, ?, 0), (8, ?, ?, 0)',
    )
    .run('g7', 'a@b.com', 'g8', 'b@b.com');
  db = createDatabase(made.d1);
  const repo = new Repository(db);
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
  auth = await cookieFor(7);
});

afterEach(() => restore());

const post = (body: string, headers = {}) =>
  POST(
    new Request('https://app.test/api/users/self/classifiers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth, ...headers },
      body,
    }),
    { params: Promise.resolve({}) },
  );

const list = (query = '') =>
  GET(
    new Request(`https://app.test/api/users/self/classifiers${query}`, {
      headers: { ...auth },
    }),
    { params: Promise.resolve({}) },
  );

const liked = JSON.stringify({ kind: 'source', value: 'x', score: 'like' });

describe('POST /api/users/self/classifiers', () => {
  it('answers 201 with the classifier', async () => {
    const res = await post(liked);
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ kind: 'source', score: 'like' });
  });

  it('answers with the new classifier’s Location', async () => {
    const res = await post(liked);
    const { id } = (await res.json()) as { id: string };
    expect(res.headers.get('location')).toMatch(
      new RegExp(`/api/users/self/classifiers/${id}$`),
    );
  });

  it('answers 200 with the new score for a kind and value trained before', async () => {
    await post(liked);
    const res = await post(liked.replace('like', 'dislike'));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ score: 'dislike' });
  });

  it('answers 400 as a problem naming the bad field', async () => {
    const res = await post(
      JSON.stringify({ kind: 'x', value: 'y', score: 'like' }),
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });

  it('answers 415 for a body that is not JSON', async () => {
    const res = await post('x', { 'Content-Type': 'text/plain' });
    expect(res.status).toBe(415);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    const res = await post(liked);
    expect(res.status).toBe(401);
  });
});

describe('GET /api/users/self/classifiers', () => {
  it('answers 200 with the person’s classifiers as a page', async () => {
    await post(liked);
    const res = await list();
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toHaveLength(1);
  });

  it('hands out a next link when more follow', async () => {
    await post(liked);
    await post(JSON.stringify({ kind: 'title', value: 'y', score: 'like' }));
    const res = await list('?limit=1');
    const body = (await res.json()) as { next?: string };
    expect(body.next).toContain('cursor=');
  });

  it('shows nobody else’s classifiers', async () => {
    await post(liked);
    auth = await cookieFor(8);
    const res = await list();
    expect(((await res.json()) as { items: unknown[] }).items).toEqual([]);
  });

  it('answers 400 for a cursor it did not issue', async () => {
    const res = await list('?cursor=nope');
    expect(res.status).toBe(400);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    const res = await list();
    expect(res.status).toBe(401);
  });
});

describe('POST /api/users/self/classifiers feeds and scopes', () => {
  const feeds = () => new Repository(db).listFeeds(7);

  it('answers 201 for a feed classifier on the person’s own feed', async () => {
    const [feed] = await feeds();
    const res = await post(
      JSON.stringify({ kind: 'feed', value: String(feed!.id), score: 'like' }),
    );
    expect(res.status).toBe(201);
  });

  it('answers 400 for a feed classifier on a feed the person does not follow', async () => {
    const [feed] = await feeds();
    auth = await cookieFor(8);
    const res = await post(
      JSON.stringify({ kind: 'feed', value: String(feed!.id), score: 'like' }),
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });

  it('answers 201 with the scope for a classifier scoped to a section', async () => {
    const section = await new Repository(db).addSection(7, 'Tech');
    const res = await post(
      JSON.stringify({
        kind: 'title',
        value: 'rust',
        score: 'super_dislike',
        section_id: String(section.id),
      }),
    );
    expect(await res.json()).toMatchObject({
      score: 'super_dislike',
      section_id: String(section.id),
    });
  });

  it('answers 400 for a scope naming another person’s feed', async () => {
    const [feed] = await feeds();
    auth = await cookieFor(8);
    const res = await post(
      JSON.stringify({
        kind: 'title',
        value: 'x',
        score: 'like',
        feed_id: String(feed!.id),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('answers 400 for a scope naming a section the person does not have', async () => {
    const res = await post(
      JSON.stringify({
        kind: 'title',
        value: 'x',
        score: 'like',
        section_id: '99',
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe('POST /api/users/self/classifiers patterns and prompts', () => {
  it('answers 201 for a regular expression on titles', async () => {
    const res = await post(
      JSON.stringify({
        kind: 'title',
        value: '^rust',
        score: 'like',
        is_regex: true,
      }),
    );
    expect(await res.json()).toMatchObject({ is_regex: true });
  });

  it('answers 400 as a problem for a pattern that could run without end', async () => {
    const res = await post(
      JSON.stringify({
        kind: 'title',
        value: '(a+)+',
        score: 'like',
        is_regex: true,
      }),
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });

  it('answers 201 for an AI prompt', async () => {
    const res = await post(
      JSON.stringify({
        kind: 'prompt',
        value: 'Stories about compilers',
        score: 'like',
      }),
    );
    expect(res.status).toBe(201);
  });
});
