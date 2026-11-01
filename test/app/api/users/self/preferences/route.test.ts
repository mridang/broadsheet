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

const { GET, PATCH } = await import('@/app/api/users/self/preferences/route');

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

const URL_ = 'https://app.test/api/users/self/preferences';
const ctx = { params: Promise.resolve({}) };

const get = () => GET(new Request(URL_, { headers: { ...auth } }), ctx);
const patch = (body: unknown, headers: Record<string, string> = {}) =>
  PATCH(
    new Request(URL_, {
      method: 'PATCH',
      headers: {
        ...auth,
        'content-type': 'application/json',
        ...headers,
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    ctx,
  );

describe('GET /api/users/self/preferences', () => {
  it('answers 200 with the defaults and an ETag', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toMatch(/^"[0-9a-f]{16}"$/);
    expect(await res.json()).toMatchObject({
      story_clustering: true,
      briefing: { enabled: true, story_count: 5 },
    });
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    expect((await get()).status).toBe(401);
  });
});

describe('PATCH /api/users/self/preferences', () => {
  it('answers 200 with the change kept', async () => {
    const res = await patch({ briefing: { style: 'editorial' } });
    expect(res.status).toBe(200);
    const body = (await (await get()).json()) as {
      briefing: { style: string };
    };
    expect(body.briefing.style).toBe('editorial');
  });

  it('answers 400 naming the bad member', async () => {
    const res = await patch({ cluster_mode: 'meaning' });
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    expect(((await res.json()) as { errors: string[] }).errors).toEqual([
      'cluster_mode: must be title or related.',
    ]);
  });

  it('answers 400 for a body that is not an object', async () => {
    expect((await patch('[1]')).status).toBe(400);
  });

  it('accepts the current ETag in If-Match', async () => {
    const tag = (await get()).headers.get('etag')!;
    expect(
      (await patch({ cluster_mark_read: true }, { 'if-match': tag })).status,
    ).toBe(200);
  });

  it('answers 412 for an older ETag', async () => {
    const tag = (await get()).headers.get('etag')!;
    await patch({ cluster_mark_read: true });
    expect(
      (await patch({ story_clustering: false }, { 'if-match': tag })).status,
    ).toBe(412);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    expect((await patch({})).status).toBe(401);
  });

  it('answers 403 for a change from another site', async () => {
    expect((await patch({}, { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(
      403,
    );
  });
});

describe('PATCH /api/users/self/preferences briefing sources', () => {
  it('answers 400 for a section that is not the person’s', async () => {
    const res = await patch({ briefing: { sources: 'section:999' } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { errors: string[] }).errors).toEqual([
      'briefing.sources: no such section.',
    ]);
  });

  it('keeps a change to the schedule', async () => {
    const res = await patch({
      briefing: { sources: 'all', frequency: 'weekly' },
    });
    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { briefing: { frequency: string } }).briefing
        .frequency,
    ).toBe('weekly');
  });
});
