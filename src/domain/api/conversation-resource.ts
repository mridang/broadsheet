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

/** A conversation with its turns, oldest first. */
export interface ConversationResource {
  readonly id: string;
  readonly created_at?: string;
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

/** The API's view of a stored conversation and its turns. */
export function conversationResource(
  conversation: Conversation,
  messages: readonly Message[],
  titles: ReadonlyMap<number, string | null> = new Map(),
): ConversationResource {
  const at = conversation.created_at
    ? rfc3339(conversation.created_at)
    : undefined;
  return {
    id: String(conversation.id),
    ...(at ? { created_at: at } : {}),
    messages: messages.map((m) => messageResource(m, titles)),
  };
}
