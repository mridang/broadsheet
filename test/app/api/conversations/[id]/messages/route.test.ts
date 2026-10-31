import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

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

const { POST } = await import('@/app/api/conversations/[id]/messages/route');

let restore: () => void;
let db: Database;
let story: number;
let conversation: number;
let auth: Record<string, string>;
let run: jest.Mock<(...args: unknown[]) => Promise<unknown>>;

async function cookieFor(uid: number): Promise<Record<string, string>> {
  return {
    cookie: `${SESSION_COOKIE}=${await tokenFor({ id: uid }, { ep: 0 })}`,
  };
}

/** Person 7 follows a source with a story about rust, and has a conversation. */
beforeEach(async () => {
  const made = sqliteD1(...APP_MIGRATIONS);
  run = jest.fn(async () => ({ response: 'Rust is safe [1].' }));
  restore = installCloudflareContext(made.d1, {
    SESSION_SECRET,
    AI: { run },
  });
  made.raw
    .prepare(
      'INSERT INTO users (id, google_sub, email, session_epoch) VALUES (7, ?, ?, 0), (8, ?, ?, 0)',
    )
    .run('g7', 'a@b.com', 'g8', 'b@b.com');
  db = databaseFrom(made.d1);
  const repo = new Repository(db);
  const { source_id } = (await repo.addFeed(7, 'https://a.test/f'))!;
  await repo.writeEdition(source_id, '2026-10-20', [
    {
      url: 'https://x/1',
      title: 'Rust',
      source: 'x',
      favicon: '',
      summary: '',
      image: '',
      published_at: '',
      points: 0,
      body_text: 'Rust is memory safe.',
    },
  ]);
  story = (await repo.sourceArticles(source_id, '2026-10-20'))[0]!.id;
  conversation = (await repo.addConversation(7)).id;
  auth = await cookieFor(7);
});

afterEach(() => restore());

const send = (id: string | number, body: string, headers = {}) =>
  POST(
    new Request(`https://app.test/api/conversations/${id}/messages`, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json', ...auth, ...headers },
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );

const turns = () => new Repository(db).listMessages(conversation);

describe('POST /api/conversations/:id/messages', () => {
  it('answers 201 with the answer citing the story it drew on', async () => {
    const res = await send(conversation, '{"content":"Is rust safe?"}');
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      role: 'assistant',
      content: 'Rust is safe [1].',
      citations: [
        { article_id: String(story), title: 'Rust', href: `/article/${story}` },
      ],
    });
  });

  it('answers with the conversation’s Location', async () => {
    const res = await send(conversation, '{"content":"Is rust safe?"}');
    expect(res.headers.get('location')).toMatch(
      new RegExp(`/api/conversations/${conversation}$`),
    );
  });

  it('keeps the question and the answer', async () => {
    await send(conversation, '{"content":"Is rust safe?"}');
    expect((await turns()).map((t) => t.role)).toEqual(['user', 'assistant']);
  });

  it('gives the model the retrieved story', async () => {
    await send(conversation, '{"content":"Is rust safe?"}');
    expect(JSON.stringify(run.mock.calls[0])).toContain('Rust is memory safe.');
  });

  it('answers 400 as a problem for a blank question', async () => {
    const res = await send(conversation, '{"content":""}');
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });

  it('answers 415 for a body that is not JSON', async () => {
    const res = await send(conversation, 'x', { 'Content-Type': 'text/plain' });
    expect(res.status).toBe(415);
  });

  it.each(['999', 'abc'])('answers 404 for conversation %j', async (id) => {
    expect((await send(id, '{"content":"Q"}')).status).toBe(404);
  });

  it('answers 404 to another person', async () => {
    auth = await cookieFor(8);
    expect((await send(conversation, '{"content":"Q"}')).status).toBe(404);
  });

  it('answers 502, keeping nothing, when the model fails', async () => {
    run.mockRejectedValue(new Error('down'));
    const res = await send(conversation, '{"content":"Q"}');
    expect(res.status).toBe(502);
    expect(await turns()).toEqual([]);
  });

  it('answers 403 for a request from another site', async () => {
    const res = await send(conversation, '{"content":"Q"}', {
      'Sec-Fetch-Site': 'cross-site',
    });
    expect(res.status).toBe(403);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    expect((await send(conversation, '{"content":"Q"}')).status).toBe(401);
  });
});
