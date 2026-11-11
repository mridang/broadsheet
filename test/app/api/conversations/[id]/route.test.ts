import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { databaseFrom } from '@/domain/db/database';
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

const { GET, DELETE } = await import('@/app/api/conversations/[id]/route');

let restore: () => void;
let conversation: number;
let auth: Record<string, string>;

async function cookieFor(uid: number): Promise<Record<string, string>> {
  return {
    cookie: `${SESSION_COOKIE}=${await tokenFor({ id: uid }, { ep: 0 })}`,
  };
}

/** Person 7 has a conversation with one question and one cited answer. */
beforeEach(async () => {
  const made = sqliteD1(...APP_MIGRATIONS);
  restore = installCloudflareContext(made.d1, { SESSION_SECRET });
  made.raw
    .prepare(
      'INSERT INTO users (id, google_sub, email, session_epoch) VALUES (7, ?, ?, 0), (8, ?, ?, 0)',
    )
    .run('g7', 'a@b.com', 'g8', 'b@b.com');
  const repo = new Repository(databaseFrom(made.d1));
  const added = await repo.addConversation(7);
  conversation = added.id;
  await repo.addMessage(conversation, 'user', 'Q');
  await repo.addMessage(conversation, 'assistant', 'A [1]', [42]);
  auth = await cookieFor(7);
});

afterEach(() => restore());

const read = (id: string | number) =>
  GET(
    new Request(`https://app.test/api/conversations/${id}`, { headers: auth }),
    { params: Promise.resolve({ id: String(id) }) },
  );

describe('GET /api/conversations/:id', () => {
  it('answers 200 with the turns, oldest first', async () => {
    const res = await read(conversation);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: String(conversation),
      messages: [
        { role: 'user', content: 'Q', citations: [] },
        {
          role: 'assistant',
          content: 'A [1]',
          citations: [{ article_id: '42', href: '/article/42' }],
        },
      ],
    });
  });

  it.each(['999', 'abc'])('answers 404 for conversation %j', async (id) => {
    const res = await read(id);
    expect(res.status).toBe(404);
  });

  it('answers 404 to another person', async () => {
    auth = await cookieFor(8);
    const res = await read(conversation);
    expect(res.status).toBe(404);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    const res = await read(conversation);
    expect(res.status).toBe(401);
  });
});

const remove = (id: string | number) =>
  DELETE(
    new Request(`https://app.test/api/conversations/${id}`, {
      method: 'DELETE',
      headers: auth,
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );

describe('DELETE /api/conversations/:id', () => {
  it('answers 204 and the conversation is gone', async () => {
    const removed = await remove(conversation);
    expect(removed.status).toBe(204);
    const res = await read(conversation);
    expect(res.status).toBe(404);
  });

  it('answers 404 the second time', async () => {
    await remove(conversation);
    const removed = await remove(conversation);
    expect(removed.status).toBe(404);
  });

  it('answers 404, removing nothing, for another person', async () => {
    auth = await cookieFor(8);
    const removed = await remove(conversation);
    expect(removed.status).toBe(404);
    auth = await cookieFor(7);
    const res = await read(conversation);
    expect(res.status).toBe(200);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    const removed = await remove(conversation);
    expect(removed.status).toBe(401);
  });
});
