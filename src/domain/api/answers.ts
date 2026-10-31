/**
 * @packageDocumentation
 *
 * Asking about one article: `POST /api/articles/{id}/answers` answers a
 * question from the article's text with Workers AI. Runs as the signed-in
 * person, and only for articles from sources they follow. The rate limit is
 * the edge's (`RL_AI`, see `lib/core/http/extras`).
 */

import {
  AnswerUnavailable,
  articlePrompt,
  complete,
  parseQuestion,
  type AnswerModel,
} from '@/domain/assistant';
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
import { getDatabase } from '@/domain/db/database';
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
  readonly question: string;
  readonly answer: string;
}

/**
 * The `{id}` segment of `/api/{collection}/{id}/{child}`: the parent a nested
 * resource belongs to.
 */
export function parentIdOf(request: Request): string {
  return new URL(request.url).pathname.split('/')[3] ?? '';
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
  return input.question;
}

/**
 * `POST /api/articles/:id/answers` {question}: 200 with the answer. 400 for a
 * bad question, 415 for a body that is not JSON, 404 when the article is not
 * from a source the person follows, 502 when the model fails, 401/403 when not
 * signed in or cross-site.
 */
export function createAnswersCollection(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  }).on<string, AnswerResource | Response>({
    method: 'POST',
    decode: (request) => readQuestion(request, 'question'),
    handle: async (question, { request, uid }) => {
      const id = parseFeedId(parentIdOf(request));
      const article =
        id !== undefined
          ? await new Repository(getDatabase()).getArticle(uid, id)
          : undefined;
      if (!article) return problems.notFound('article');
      try {
        const answer = await complete(
          answerModel(),
          articlePrompt(article, question),
        );
        return { article_id: String(article.id), question, answer };
      } catch (error) {
        if (error instanceof AnswerUnavailable) {
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
