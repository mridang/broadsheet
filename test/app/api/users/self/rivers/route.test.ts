import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { databaseFrom, type Database } from '@/domain/db/database';
import { Repository } from '@/domain/repository';
import { RiverRepository } from '@/domain/rivers';
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

const { GET, POST, PUT } = await import('@/app/api/users/self/rivers/route');

let restore: () => void;
let db: Database;
let auth: Record<string, string>;
let mine: number;
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
  const repo = new Repository(db);
  mine = (await repo.addFeed(7, 'https://a.test/f'))!.id;
  const section = await repo.addSection(8, 'Theirs');
  theirs = section.id;
  auth = {
    cookie: `${SESSION_COOKIE}=${await tokenFor({ id: 7 }, { ep: 0 })}`,
  };
});

afterEach(() => restore());

const send = (method: 'POST' | 'PUT', body: string, headers = {}) =>
  (method === 'POST' ? POST : PUT)(
    new Request('https://app.test/api/users/self/rivers', {
      method,
      headers: { 'Content-Type': 'application/json', ...auth, ...headers },
      body,
    }),
  );

const rivers = () => new RiverRepository(db).list(7);

describe('POST /api/users/self/rivers', () => {
  it('answers 201 with the pinned river and where to find it', async () => {
    const res = await send(
      'POST',
      JSON.stringify({ river_id: `feed:${mine}`, side: 'left', position: 0 }),
    );
    expect(res.status).toBe(201);
    const river = (await res.json()) as { id: string };
    expect(river).toMatchObject({ river_id: `feed:${mine}`, side: 'left' });
    expect(res.headers.get('location')).toBe(
      `https://app.test/api/users/self/rivers/${river.id}`,
    );
  });

  it('answers 200 when the place was taken, changing what it lists', async () => {
    await send('POST', '{"river_id":"all","side":"left","position":0}');
    const res = await send(
      'POST',
      '{"river_id":"saves","side":"left","position":0}',
    );
    expect(res.status).toBe(200);
    const list = await rivers();
    expect(list.map((r) => r.river_id)).toEqual(['saves']);
  });

  it('answers 400 for a river listing another person’s section', async () => {
    const res = await send(
      'POST',
      JSON.stringify({
        river_id: `section:${theirs}`,
        side: 'left',
        position: 0,
      }),
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { errors: string[] }).errors).toEqual([
      `river_id: no such section:${theirs}.`,
    ]);
    expect(await rivers()).toEqual([]);
  });

  it('answers 400 as a problem for a bad river', async () => {
    const res = await send(
      'POST',
      '{"river_id":"all","side":"up","position":0}',
    );
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });

  it('answers 415 for a body that is not JSON', async () => {
    const res = await send('POST', 'x', { 'Content-Type': 'text/plain' });
    expect(res.status).toBe(415);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    const res = await send(
      'POST',
      '{"river_id":"all","side":"left","position":0}',
    );
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/users/self/rivers', () => {
  it('answers 200 with every river replaced', async () => {
    await send('POST', '{"river_id":"all","side":"left","position":0}');
    const res = await send(
      'PUT',
      JSON.stringify({
        items: [
          { river_id: 'saves', side: 'right', position: 0 },
          { river_id: `feed:${mine}`, side: 'left', position: 0 },
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { items: { river_id: string }[] }).items.map(
        (r) => r.river_id,
      ),
    ).toEqual([`feed:${mine}`, 'saves']);
  });

  it('answers 400 and changes nothing when one river is not the caller’s', async () => {
    await send('POST', '{"river_id":"all","side":"left","position":0}');
    const res = await send(
      'PUT',
      JSON.stringify({
        items: [{ river_id: `section:${theirs}`, side: 'left', position: 0 }],
      }),
    );
    expect(res.status).toBe(400);
    const list = await rivers();
    expect(list.map((r) => r.river_id)).toEqual(['all']);
  });
});

describe('GET /api/users/self/rivers', () => {
  it('lists only the caller’s rivers', async () => {
    await new RiverRepository(db).place(8, {
      river_id: 'all',
      side: 'left',
      position: 0,
    });
    await send('POST', '{"river_id":"saves","side":"right","position":0}');
    const res = await GET(
      new Request('https://app.test/api/users/self/rivers', { headers: auth }),
    );
    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { items: { river_id: string }[] }).items,
    ).toMatchObject([{ river_id: 'saves', side: 'right' }]);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    const res = await GET(
      new Request('https://app.test/api/users/self/rivers', {
        headers: auth,
      }),
    );
    expect(res.status).toBe(401);
  });
});
