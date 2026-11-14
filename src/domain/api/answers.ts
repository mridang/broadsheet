/**
 * @packageDocumentation
 *
 * Asking about one article: `POST /api/articles/{id}/answers` answers a
 * question from the article's text with Workers AI. Runs as the signed-in
 * person, and only for articles from sources they follow. The rate limit is
 * the edge's (`RL_AI`, see `lib/core/http/extras`).
 */

import {
  AnswerUnavailableError,
  articlePrompt,
  cacheKey,
  complete,
  modelFor,
  streamAnswer,
  withoutThinking,
  type AnswerModelName,
  parseAnswerRequest,
  parseQuestion,
  type AnswerModel,
  type AnswerRequest,
} from '@/domain/assistant';
import { budget, overBudget } from '@/domain/api/usage';
import {
  liveUid,
  requestCookieResolver,
  type CurrentUserResolver,
} from '@/domain/api/auth';
import { parseFeedId } from '@/domain/api/feed-resource';
import {
  ApiController,
  ok,
  problem,
  problems,
  readJsonObject,
} from '@/lib/core/api';
import { getEnv } from '@/lib/core/runtime';
import { getDatabase } from '@/domain/db/client';
import { Repository } from '@/domain/repository';
import { logWarn } from '@/utils/logging';

/** The signed-in caller's id and the request. */
interface UidContext {
  readonly request: Request;
  readonly uid: number;
}

/** The answer to a question about an article. */
export interface AnswerResource {
  readonly article_id: string;
  /** The preset asked, when it was one. */
  readonly question_id?: string;
  readonly question: string;
  readonly answer: string;
  /** The model picked. */
  readonly model: AnswerModelName;
  /** Whether the model that thinks first answered. */
  readonly thinking: boolean;
  /** Whether the answer was given before and served again. */
  readonly cached: boolean;
  /** Questions left today. */
  readonly remaining: number;
}

/**
 * The `{id}` segment of `/api/{collection}/{id}/{child}`: the parent a nested
 * resource belongs to.
 */
export function parentIdOf(request: Request): string {
  return new URL(request.url).pathname.split('/', 4)[3] ?? '';
}

/** The 502 for a model that could not answer. */
export function assistantUnavailable(error: unknown): Response {
  logWarn({
    event: 'assistant.failed',
    error: error instanceof Error ? error.message : String(error),
  });
  return problem(
    502,
    '/problems/assistant-unavailable',
    'Bad gateway',
    'The assistant could not answer just now. Try again later.',
  );
}

/** The `AI` binding as the answer model, or undefined when it is not bound. */
export function answerModel(): AnswerModel | undefined {
  return getEnv().AI as unknown as AnswerModel | undefined;
}

/** Read a JSON object body and the question in it under `key`, or throw the 4xx. */
export async function readQuestion(
  request: Request,
  key: 'question' | 'content',
): Promise<string> {
  const body = await readJsonObject(request, 'The body must be a JSON object.');
  if (!body.ok) throw body.response;
  const input = parseQuestion(body.value, key);
  if (!input.ok) {
    throw problems.badRequest('The question is not valid.', input.errors);
  }
  return input.value;
}

/** Read the body of a question about an article, or throw the 4xx. */
async function readAnswerRequest(request: Request): Promise<AnswerRequest> {
  const body = await readJsonObject(request, 'The body must be a JSON object.');
  if (!body.ok) throw body.response;
  const input = parseAnswerRequest(body.value);
  if (!input.ok) {
    throw problems.badRequest('The question is not valid.', input.errors);
  }
  return input.value;
}

/** One server-sent event. */
export function sseEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * The answer as server-sent events, after NewsBlur's streamed answers:
 * `start`, a `chunk` for each piece of text, then `complete` with the whole
 * answer resource (once it is kept and counted), or `error` when the model
 * fails part way.
 */
function streamed(
  pieces: AsyncGenerator<string>,
  finish: (answer: string) => Promise<AnswerResource>,
): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(sseEvent(event, data)));
      send('start', {});
      let text = '';
      try {
        for await (const piece of pieces) {
          text += piece;
          send('chunk', { text: piece });
        }
        const answer = withoutThinking(text);
        if (!answer)
          throw new AnswerUnavailableError('The model gave no answer.');
        send('complete', await finish(answer));
      } catch (error) {
        logWarn({
          event: 'assistant.failed',
          error: error instanceof Error ? error.message : String(error),
        });
        send('error', {
          detail: 'The assistant could not answer just now. Try again later.',
        });
      }
      controller.close();
    },
  });
  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * `POST /api/articles/:id/answers` {question_id | question, history?, model?,
 * thinking?}: 200 with the answer. The same question is also answered as
 * server-sent events by `POST /events/articles/:id/answers`, which is not REST
 * and so lives outside `/api` (see {@link answersStream}). A preset question with no history is answered
 * once per model and then served from the cache (`cached`, not counted
 * against the budget). 400 for a bad question, 415 for a body that is not
 * JSON, 404 when the article is not from a source the person follows, 429
 * when today's budget is used up, 502 when the model fails, 401/403 when not
 * signed in or cross-site.
 */
export function createAnswersCollection(
  resolver: CurrentUserResolver = requestCookieResolver,
  stream = false,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  }).on<AnswerRequest, AnswerResource | Response>({
    method: 'POST',
    decode: readAnswerRequest,
    handle: async (call, { request, uid }) => {
      const { question, history, model, thinking } = call;
      const repo = new Repository(getDatabase());
      const id = parseFeedId(parentIdOf(request));
      const article =
        id === undefined ? undefined : await repo.getArticle(uid, id);
      if (!article) return problems.notFound('article');
      const preset = question.kind === 'preset' ? question.preset : undefined;
      const text =
        question.kind === 'preset'
          ? question.preset.question
          : question.question;
      const answered = async (
        answer: string,
        cached: boolean,
      ): Promise<AnswerResource> => {
        const { remaining } = await budget(repo, uid, 'answer');
        return {
          article_id: String(article.id),
          ...(preset ? { question_id: preset.id } : {}),
          question: text,
          answer,
          model,
          thinking,
          cached,
          remaining,
        };
      };
      const key =
        preset && history.length === 0 ? cacheKey(preset.id, call) : undefined;
      const cached = key
        ? await repo.cachedAnswer(uid, article.id, key)
        : undefined;
      if (cached !== undefined) {
        await repo.recordUsage(uid, 'answer', true);
        const resource = await answered(cached, true);
        return stream
          ? streamed(
              (async function* () {
                yield cached;
              })(),
              async () => resource,
            )
          : resource;
      }
      const refusal = await overBudget(repo, uid, 'answer');
      if (refusal) return refusal;
      const prompt = articlePrompt(article, text, history);
      const keep = async (answer: string): Promise<AnswerResource> => {
        await repo.recordUsage(uid, 'answer');
        if (key) await repo.storeAnswer(uid, article.id, key, answer);
        return answered(answer, false);
      };
      if (stream) {
        return streamed(
          streamAnswer(answerModel(), prompt, modelFor(call)),
          keep,
        );
      }
      try {
        return await keep(
          await complete(answerModel(), prompt, modelFor(call)),
        );
      } catch (error) {
        if (error instanceof AnswerUnavailableError) {
          return assistantUnavailable(error);
        }
        throw error;
      }
    },
    encode: (result) =>
      result instanceof Response
        ? result
        : ok(result, { headers: { 'Cache-Control': 'no-store' } }),
  });
}

/** The answers controller bound to the production resolver. */
export const answersCollection = createAnswersCollection();

/**
 * The same question, answered as server-sent events. A stream is not a REST
 * resource, so this is mounted at `/events/articles/{id}/answers`, not under
 * `/api`. Its errors are still problems, thrown before the stream starts.
 */
export const answersStream = createAnswersCollection(
  requestCookieResolver,
  true,
);
