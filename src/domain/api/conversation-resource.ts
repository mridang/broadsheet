/**
 * @packageDocumentation
 *
 * Answers and conversations on the wire: what `/api/articles/{id}/answers`
 * and `/api/conversations` send.
 */

import { rfc3339 } from '@/domain/api/feed-resource';
import type { Conversation, Message } from '@/domain/repository';

/** An article an answer drew on, with the page that shows it. */
export interface CitationResource {
  readonly article_id: string;
  readonly title?: string;
  readonly href: string;
}

/** A turn of a conversation. */
export interface MessageResource {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly citations: readonly CitationResource[];
  readonly created_at?: string;
}

/** A conversation as a list shows it. */
export interface ConversationSummaryResource {
  readonly id: string;
  /** Its first question, cut short; absent before the first question. */
  readonly title?: string;
  readonly created_at?: string;
  /** When its last turn was added. */
  readonly updated_at?: string;
}

/** A conversation with its turns, oldest first. */
export interface ConversationResource extends ConversationSummaryResource {
  readonly messages: readonly MessageResource[];
}

/** The citation of one article, with its title when it is known. */
export function citationResource(
  id: number,
  titles: ReadonlyMap<number, string | null> = new Map(),
): CitationResource {
  const title = titles.get(id);
  return {
    article_id: String(id),
    ...(title ? { title } : {}),
    href: `/article/${id}`,
  };
}

/** The API's view of a stored turn. */
export function messageResource(
  message: Message,
  titles: ReadonlyMap<number, string | null> = new Map(),
): MessageResource {
  const at = message.created_at ? rfc3339(message.created_at) : undefined;
  return {
    id: String(message.id),
    role: message.role,
    content: message.content,
    citations: message.citations.map((id) => citationResource(id, titles)),
    ...(at ? { created_at: at } : {}),
  };
}

/** The API's view of a stored conversation, without its turns. */
export function conversationSummaryResource(
  conversation: Conversation,
): ConversationSummaryResource {
  const at = conversation.created_at
    ? rfc3339(conversation.created_at)
    : undefined;
  const updated = conversation.updated_at
    ? rfc3339(conversation.updated_at)
    : undefined;
  return {
    id: String(conversation.id),
    ...(conversation.title ? { title: conversation.title } : {}),
    ...(at ? { created_at: at } : {}),
    ...(updated ? { updated_at: updated } : {}),
  };
}

/** The API's view of a stored conversation and its turns. */
export function conversationResource(
  conversation: Conversation,
  messages: readonly Message[],
  titles: ReadonlyMap<number, string | null> = new Map(),
): ConversationResource {
  return {
    ...conversationSummaryResource(conversation),
    messages: messages.map((m) => messageResource(m, titles)),
  };
}
