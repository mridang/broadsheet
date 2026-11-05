import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import {
  ANSWER_MODELS,
  DAILY_LIMITS,
  THINKING_MODEL,
  presetQuestion,
} from '@/domain/assistant';
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

const { POST } = await import('@/app/api/articles/[id]/answers/route');

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
  story = (await repo.sourceArticles(source_id, '2026-10-20'))[0]!.id;
  auth = await cookieFor(7);
});

afterEach(() => restore());

const ask = (id: string | number, body: string, headers = {}) =>
  POST(
    new Request(`https://app.test/api/articles/${id}/answers`, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json', ...auth, ...headers },
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );

describe('POST /api/articles/:id/answers', () => {
  it('answers 200 with the model’s answer', async () => {
    const res = await ask(story, '{"question":"What is it about?"}');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      article_id: String(story),
      question: 'What is it about?',
      answer: 'It is about rust.',
      model: 'fast',
      thinking: false,
      cached: false,
      remaining: DAILY_LIMITS.answer - 1,
    });
  });

  it('asks the model the reader picked, and the thinking one when asked', async () => {
    await ask(story, '{"question":"Q","model":"large"}');
    await ask(story, '{"question":"Q","thinking":true}');
    expect(run.mock.calls.map((c) => c[0])).toEqual([
      ANSWER_MODELS.large,
      THINKING_MODEL,
    ]);
  });

  it('caches a preset per model', async () => {
    await ask(story, '{"question_id":"bullets"}');
    const res = await ask(story, '{"question_id":"bullets","model":"large"}');
    expect(await res.json()).toMatchObject({ cached: false, model: 'large' });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('answers JSON even when server-sent events are asked for', async () => {
    const res = await ask(story, '{"question_id":"bullets"}', {
      Accept: 'text/event-stream',
    });
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('answers a preset by id, naming it', async () => {
    const res = await ask(story, '{"question_id":"bullets"}');
    expect(await res.json()).toMatchObject({
      question_id: 'bullets',
      question: presetQuestion('bullets')?.question,
      cached: false,
    });
  });

  it('serves a preset asked again from the cache, without the model or the budget', async () => {
    await ask(story, '{"question_id":"bullets"}');
    const res = await ask(story, '{"question_id":"bullets"}');
    expect(await res.json()).toMatchObject({
      answer: 'It is about rust.',
      cached: true,
      remaining: DAILY_LIMITS.answer - 1,
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not cache the reader’s own questions', async () => {
    await ask(story, '{"question":"Why?"}');
    await ask(story, '{"question":"Why?"}');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('sends a follow-up’s history to the model, uncached', async () => {
    const body = JSON.stringify({
      question_id: 'bullets',
      history: [{ role: 'assistant', content: 'Earlier answer' }],
    });
    await ask(story, body);
    await ask(story, body);
    expect(run).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(run.mock.calls[0])).toContain('Earlier answer');
  });

  it('answers 429 with Retry-After once today’s budget is used up', async () => {
    for (let i = 0; i < DAILY_LIMITS.answer; i++) {
      await new Repository(db).recordUsage(7, 'answer');
    }
    const res = await ask(story, '{"question":"Q"}');
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toMatch(/^\d+$/);
    expect(run).not.toHaveBeenCalled();
  });

  it('answers 400 as a problem for an unknown preset', async () => {
    expect((await ask(story, '{"question_id":"nope"}')).status).toBe(400);
  });

  it('asks the model with the story’s text', async () => {
    await ask(story, '{"question":"Why?"}');
    expect(JSON.stringify(run.mock.calls[0])).toContain('All about rust.');
  });

  it('answers 400 as a problem for a blank question', async () => {
    const res = await ask(story, '{"question":" "}');
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });

  it('answers 415 for a body that is not JSON', async () => {
    const res = await ask(story, 'x', { 'Content-Type': 'text/plain' });
    expect(res.status).toBe(415);
  });

  it.each(['999', 'abc'])('answers 404 for article %j', async (id) => {
    expect((await ask(id, '{"question":"Q"}')).status).toBe(404);
  });

  it('answers 404 to someone who does not follow the story’s source', async () => {
    auth = await cookieFor(8);
    expect((await ask(story, '{"question":"Q"}')).status).toBe(404);
    expect(run).not.toHaveBeenCalled();
  });

  it('answers 502 as a problem when the model fails', async () => {
    run.mockRejectedValue(new Error('down'));
    const res = await ask(story, '{"question":"Q"}');
    expect(res.status).toBe(502);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
  });

  it('answers 403 for a request from another site', async () => {
    const res = await ask(story, '{"question":"Q"}', {
      'Sec-Fetch-Site': 'cross-site',
    });
    expect(res.status).toBe(403);
  });

  it('answers 401 when nobody is signed in', async () => {
    auth = {};
    expect((await ask(story, '{"question":"Q"}')).status).toBe(401);
  });
});
