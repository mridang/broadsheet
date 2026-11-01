import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { SESSION_COOKIE } from '@/domain/auth/app';
import { APP_MIGRATIONS } from '../../../lib/core/db/migrations';
import {
  installCloudflareContext,
  sqliteD1,
} from '../../../lib/core/db/sqlite-d1';
import { SESSION_SECRET, tokenFor } from '../../../domain/auth/auth-test-kit';

const { GET, POST } = await import('@/app/api/conversations/route');

let restore: () => void;
let auth: Record<string, string>;

beforeEach(async () => {
  const made = sqliteD1(...APP_MIGRATIONS);
  restore = installCloudflareContext(made.d1, { SESSION_SECRET });
  made.raw
    .prepare(
      'INSERT INTO users (id, google_sub, email, session_epoch) VALUES (7, ?, ?, 0)',
    )
    .run('g7', 'a@b.com');
  auth = {
    cookie: `${SESSION_COOKIE}=${await tokenFor({ id: 7 }, { ep: 0 })}`,
  };
});

afterEach(() => restore());

const start = (headers: Record<string, string> = {}) =>
  POST(
    new Request('https://app.test/api/conversations', {
      method: 'POST',
      headers: { ...auth, ...headers },
    }),
  );

describe('POST /api/conversations', () => {
  it('answers 201 with an empty conversation', async () => {
    const res = await start();
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ messages: [] });
  });

  it('answers with the conversation’s Location', async () => {
    const res = await start();
    const { id } = (await res.json()) as { id: string };
    expect(res.headers.get('location')).toMatch(
      new RegExp(`/api/conversations/${id}$`),
    );
  });

  it('answers 403 for a request from another site', async () => {
    expect((await start({ 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    expect((await start()).status).toBe(401);
  });
});

const list = (query = '') =>
  GET(
    new Request(`https://app.test/api/conversations${query}`, {
      headers: auth,
    }),
  );

describe('GET /api/conversations', () => {
  it('answers 200 with the person’s conversations, newest first', async () => {
    const first = (await (await start()).json()) as { id: string };
    const second = (await (await start()).json()) as { id: string };
    const res = await list();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { id: string }[] };
    expect(body.items.map((c) => c.id)).toEqual([second.id, first.id]);
  });

  it('pages with a cursor', async () => {
    await start();
    await start();
    const body = (await (await list('?limit=1')).json()) as { next?: string };
    expect(body.next).toMatch(/cursor=/);
  });

  it('answers 400 as a problem for a bad cursor', async () => {
    const res = await list('?cursor=nope');
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    expect((await list()).status).toBe(401);
  });
});
