import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

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

const { GET, PUT, DELETE } = await import('@/app/api/users/self/player/route');

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

const call = (method: 'GET' | 'PUT' | 'DELETE', body?: unknown) =>
  ({ GET, PUT, DELETE })[method](
    new Request('https://app.test/api/users/self/player', {
      method,
      headers: {
        ...auth,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    { params: Promise.resolve({}) },
  );

const state = {
  rate: 1.5,
  current: { article_id: '3', position: 120 },
  queue: ['4', '5'],
  history: ['2'],
};

describe('GET /api/users/self/player', () => {
  it('answers the empty player for someone who never listened', async () => {
    const res = await call('GET');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      rate: 1,
      current: null,
      queue: [],
      history: [],
    });
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    expect((await call('GET')).status).toBe(401);
  });
});

describe('PUT /api/users/self/player', () => {
  it('stores the player and answers it', async () => {
    const res = await call('PUT', state);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(state);
    expect(await (await call('GET')).json()).toEqual(state);
  });

  it('answers 400 for a rate out of range', async () => {
    expect((await call('PUT', { ...state, rate: 9 })).status).toBe(400);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    expect((await call('PUT', state)).status).toBe(401);
  });
});

describe('DELETE /api/users/self/player', () => {
  it('answers 204 and forgets the player', async () => {
    await call('PUT', state);
    expect((await call('DELETE')).status).toBe(204);
    expect(
      ((await (await call('GET')).json()) as { queue: string[] }).queue,
    ).toEqual([]);
  });

  it('answers 404 when there was no player', async () => {
    expect((await call('DELETE')).status).toBe(404);
  });
});
