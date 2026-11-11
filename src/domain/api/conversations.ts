/**
 * @packageDocumentation
 *
 * The archive assistant, after NewsBlur's: `GET`/`POST /api/conversations`
 * list and start conversations, `GET`/`DELETE /api/conversations/{id}` read
 * one back or remove it, `POST /api/conversations/{id}/messages` asks a
 * question, and `GET /api/conversations/suggestions` offers starter questions.
 * An answer searches the person's followed sources, saves and reads with tools
 * ({@link ToolRunner}) and cites the stories it used. Each runs as the
 * signed-in person; a conversation is only ever its owner's.
 */

import { AnswerUnavailableError, starterQuestions } from '@/domain/assistant';
import { answerTurn } from '@/domain/assistant-tools';
import {
  answerModel,
  assistantUnavailable,
  parentIdOf,
  readQuestion,
} from '@/domain/api/answers';
import {
  liveUid,
  requestCookieResolver,
  type CurrentUserResolver,
} from '@/domain/api/auth';
import {
  conversationResource,
  conversationSummaryResource,
  messageResource,
  type ConversationResource,
  type MessageResource,
} from '@/domain/api/conversation-resource';
import { parseFeedId } from '@/domain/api/feed-resource';
import { idOf } from '@/domain/api/feeds';
import { newestPage, pageRequest, type PageRequest } from '@/domain/api/paging';
import { overBudget } from '@/domain/api/usage';
import {
  ApiController,
  created,
  noContent,
  ok,
  page,
  problems,
  type Slice,
} from '@/lib/core/api';
import { getDatabase } from '@/domain/db/database';
import { Repository, type ConversationSummary } from '@/domain/repository';

/** The signed-in caller's id and the request. */
interface UidContext {
  readonly request: Request;
  readonly uid: number;
}

/** No-store, for anything personal. */
const PRIVATE = { 'Cache-Control': 'no-store' };

/** Build the per-request context of a signed-in caller. */
const signedIn =
  (resolver: CurrentUserResolver) =>
  async (request: Request): Promise<UidContext> => ({
    request,
    uid: await liveUid(request, resolver),
  });

/**
 * `GET /api/conversations?limit&cursor`: the person's conversations, last
 * active first, without their turns. 400 for a bad limit or cursor.
 *
 * `POST /api/conversations`: start a conversation. 201 with it (no turns yet)
 * and its `Location`.
 *
 * Both answer 401/403 when not signed in or cross-site.
 */
export function createConversationsCollection(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({ context: signedIn(resolver) })
    .on<PageRequest, Slice<ConversationSummary>>({
      method: 'GET',
      decode: pageRequest,
      handle: async (paging, { uid }) =>
        newestPage(
          await new Repository(getDatabase()).listConversations(uid),
          (c) => ({
            key: c.updated_at ?? c.created_at ?? '',
            id: String(c.id),
          }),
          paging,
        ),
      encode: (slice) =>
        page(
          slice.items.map((item) => conversationSummaryResource(item)),
          slice.next,
          PRIVATE,
        ),
    })
    .on<null, ConversationResource>({
      method: 'POST',
      handle: async (_input, { uid }) =>
        conversationResource(
          await new Repository(getDatabase()).addConversation(uid),
          [],
        ),
      encode: (body) => created(body, `/api/conversations/${body.id}`, PRIVATE),
    });
}

/** The conversations controller bound to the production resolver. */
export const conversationsCollection = createConversationsCollection();

/**
 * `GET /api/conversations/:id`: the conversation with its turns.
 *
 * `DELETE /api/conversations/:id`: remove it and its turns. 204.
 *
 * Both answer 404 when it is not the person's, 401/403 when not signed in or
 * cross-site.
 */
export function createConversationItem(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({ context: signedIn(resolver) })
    .on<null, ConversationResource | undefined>({
      method: 'GET',
      handle: async (_input, { request, uid }) => {
        const repo = new Repository(getDatabase());
        const id = parseFeedId(idOf(request));
        const conversation =
          id === undefined ? undefined : await repo.getConversation(uid, id);
        if (!conversation) return undefined;
        const turns = await repo.listMessages(conversation.id);
        return conversationResource(
          conversation,
          turns,
          await repo.articleTitles(turns.flatMap((t) => t.citations)),
        );
      },
      encode: (body) =>
        body
          ? ok(body, { headers: PRIVATE })
          : problems.notFound('conversation'),
    })
    .on<null, boolean>({
      method: 'DELETE',
      handle: async (_input, { request, uid }) => {
        const id = parseFeedId(idOf(request));
        return id === undefined
          ? false
          : new Repository(getDatabase()).removeConversation(uid, id);
      },
      encode: (removed) =>
        removed ? noContent() : problems.notFound('conversation'),
    });
}

/** The conversation-item controller bound to the production resolver. */
export const conversationItem = createConversationItem();

/**
 * `POST /api/conversations/:id/messages` {content}: ask the assistant. It
 * searches the archive with its tools, and the question and the answer are
 * both kept as turns; 201 with the answer, its citations linking to
 * `/article/{id}`, and the conversation's `Location`. 400 for a bad question,
 * 415 for a body that is not JSON, 404 when the conversation is not the
 * person's, 429 when today's budget is used up, 502 when the model fails
 * (nothing is kept), 401/403 when not signed in or cross-site.
 */
export function createMessagesCollection(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({ context: signedIn(resolver) }).on<
    string,
    { id: number; message: MessageResource } | Response
  >({
    method: 'POST',
    decode: (request) => readQuestion(request, 'content'),
    handle: async (question, { request, uid }) => {
      const repo = new Repository(getDatabase());
      const id = parseFeedId(parentIdOf(request));
      const conversation =
        id === undefined ? undefined : await repo.getConversation(uid, id);
      if (!conversation) return problems.notFound('conversation');
      const refusal = await overBudget(repo, uid, 'assistant');
      if (refusal) return refusal;
      try {
        const { reply, titles } = await answerTurn(
          repo,
          uid,
          conversation.id,
          question,
          answerModel(),
        );
        return {
          id: conversation.id,
          message: messageResource(reply, titles),
        };
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
        : created(result.message, `/api/conversations/${result.id}`, PRIVATE),
  });
}

/** The messages controller bound to the production resolver. */
export const messagesCollection = createMessagesCollection();

/**
 * `GET /api/conversations/suggestions`: starter questions for the assistant,
 * from the sources the person reads most and the tags they save under. 200
 * with `{items}`, 401 when not signed in.
 */
export function createConversationSuggestions(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({ context: signedIn(resolver) }).on<
    null,
    string[]
  >({
    method: 'GET',
    handle: async (_input, { uid }) =>
      starterQuestions(await new Repository(getDatabase()).archiveSummary(uid)),
    encode: (items) => page(items, undefined, PRIVATE),
  });
}

/** The conversation-suggestions controller bound to the production resolver. */
export const conversationSuggestions = createConversationSuggestions();
