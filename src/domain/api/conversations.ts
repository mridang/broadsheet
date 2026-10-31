/**
 * @packageDocumentation
 *
 * The archive assistant: `POST /api/conversations` starts a conversation,
 * `GET /api/conversations/{id}` reads it back, and
 * `POST /api/conversations/{id}/messages` asks it a question. The answer
 * draws on passages retrieved from the full-text index over the person's
 * followed sources, saves and reads, and cites the articles it used. Each
 * runs as the signed-in person; a conversation is only ever its owner's.
 */

import {
  AnswerUnavailable,
  archivePrompt,
  citedIds,
  complete,
} from '@/domain/assistant';
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
  messageResource,
  type ConversationResource,
  type MessageResource,
} from '@/domain/api/conversation-resource';
import { parseFeedId } from '@/domain/api/feed-resource';
import { idOf } from '@/domain/api/feeds';
import { ApiController, created, ok, problems } from '@/lib/core/api';
import { getDatabase } from '@/domain/db/database';
import { Repository } from '@/domain/repository';

/** The signed-in caller's id and the request. */
interface UidContext {
  readonly request: Request;
  readonly uid: number;
}

/** No-store, for anything personal. */
const PRIVATE = { 'Cache-Control': 'no-store' };

/**
 * `POST /api/conversations`: start a conversation. 201 with it (no turns yet)
 * and its `Location`; 401/403 when not signed in or cross-site.
 */
export function createConversationsCollection(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  }).on<null, ConversationResource>({
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
 * `GET /api/conversations/:id`: the conversation with its turns. 404 when it
 * is not the person's, 401 when not signed in.
 */
export function createConversationItem(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  }).on<null, ConversationResource | undefined>({
    method: 'GET',
    handle: async (_input, { request, uid }) => {
      const repo = new Repository(getDatabase());
      const id = parseFeedId(idOf(request));
      const conversation =
        id !== undefined ? await repo.getConversation(uid, id) : undefined;
      if (!conversation) return undefined;
      const turns = await repo.listMessages(conversation.id);
      return conversationResource(
        conversation,
        turns,
        await repo.articleTitles(turns.flatMap((t) => t.citations)),
      );
    },
    encode: (body) =>
      body ? ok(body, { headers: PRIVATE }) : problems.notFound('conversation'),
  });
}

/** The conversation-item controller bound to the production resolver. */
export const conversationItem = createConversationItem();

/**
 * `POST /api/conversations/:id/messages` {content}: ask the assistant. The
 * question and the answer are both kept as turns; 201 with the answer, its
 * citations linking to `/article/{id}`, and the conversation's `Location`.
 * 400 for a bad question, 415 for a body that is not JSON, 404 when the
 * conversation is not the person's, 502 when the model fails (nothing is
 * kept), 401/403 when not signed in or cross-site.
 */
export function createMessagesCollection(
  resolver: CurrentUserResolver = requestCookieResolver,
): ApiController<UidContext> {
  return new ApiController<UidContext>({
    context: async (request) => ({
      request,
      uid: await liveUid(request, resolver),
    }),
  }).on<string, { id: number; message: MessageResource } | Response>({
    method: 'POST',
    decode: (request) => readQuestion(request, 'content'),
    handle: async (question, { request, uid }) => {
      const repo = new Repository(getDatabase());
      const id = parseFeedId(parentIdOf(request));
      const conversation =
        id !== undefined ? await repo.getConversation(uid, id) : undefined;
      if (!conversation) return problems.notFound('conversation');
      const history = await repo.listMessages(conversation.id);
      const passages = await repo.retrievePassages(uid, question);
      let answer: string;
      try {
        answer = await complete(
          answerModel(),
          archivePrompt(passages, history, question),
        );
      } catch (error) {
        if (error instanceof AnswerUnavailable) {
          return assistantUnavailable(error);
        }
        throw error;
      }
      const citations = citedIds(answer, passages);
      await repo.addMessage(conversation.id, 'user', question);
      const reply = await repo.addMessage(
        conversation.id,
        'assistant',
        answer,
        citations,
      );
      const titles = new Map(passages.map((p) => [p.id, p.title] as const));
      return { id: conversation.id, message: messageResource(reply, titles) };
    },
    encode: (result) =>
      result instanceof Response
        ? result
        : created(result.message, `/api/conversations/${result.id}`, PRIVATE),
  });
}

/** The messages controller bound to the production resolver. */
export const messagesCollection = createMessagesCollection();
