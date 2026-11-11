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

const { POST } = await import('@/app/events/articles/[id]/answers/route');

let restore: () => void;
let story: number;
let db: Database;
let auth: Record<string, string>;
let run: jest.Mock<(...args: unknown[]) => Promise<unknown>>;

async function cookieFor(uid: number): Promise<Record<string, string>> {
  return {
    cookie: `${SESSION_COOKIE}=${await tokenFor({ id: uid }, { ep: 0 })}`,
  };
}

/** Two people; person 7 follows a source with one story. */
beforeEach(async () => {
  const made = sqliteD1(...APP_MIGRATIONS);
  run = jest.fn(async () => ({ response: 'It is about rust.' }));
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
      title: 'One',
      source: 'x',
      favicon: '',
      summary: '',
      image: '',
      published_at: '',
      points: 0,
      body_text: 'All about rust.',
    },
  ]);
  const articles = await repo.sourceArticles(source_id, '2026-10-20');
  story = articles[0]!.id;
  auth = await cookieFor(7);
});

afterEach(() => restore());

const ask = (id: string | number, body: string, headers = {}) =>
  POST(
    new Request(`https://app.test/events/articles/${id}/answers`, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json', ...auth, ...headers },
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );

describe('POST /events/articles/:id/answers', () => {
  it('streams the answer as server-sent events when asked', async () => {
    run.mockResolvedValue(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'data: {"response":"It is "}\n\ndata: {"response":"rust."}\n\ndata: [DONE]\n\n',
            ),
          );
          controller.close();
        },
      }),
    );
    const res = await ask(story, '{"question_id":"bullets"}', {
      Accept: 'text/event-stream',
    });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text();
    expect(text).toContain('event: chunk\ndata: {"text":"It is "}');
    expect(text).toContain('event: complete');
    expect(text).toContain('"answer":"It is rust."');
    expect(await new Repository(db).cachedAnswer(7, story, 'bullets')).toBe(
      'It is rust.',
    );
  });

  it('streams a cached answer too', async () => {
    await ask(story, '{"question_id":"bullets"}');
    const res = await ask(story, '{"question_id":"bullets"}', {
      Accept: 'text/event-stream',
    });
    expect(await res.text()).toContain('"cached":true');
  });

  it('ends a stream with an error event when the model fails', async () => {
    run.mockRejectedValue(new Error('down'));
    const res = await ask(story, '{"question":"Q"}', {
      Accept: 'text/event-stream',
    });
    expect(await res.text()).toContain('event: error');
  });

  it('refuses a caller who is not signed in with a problem', async () => {
    auth = {};
    const res = await ask(story, '{"question":"Q"}');
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain(
      'application/problem+json',
    );
  });

  it('refuses a question that is not valid before the stream starts', async () => {
    const res = await ask(story, '{}');
    expect(res.status).toBe(400);
  });
});
