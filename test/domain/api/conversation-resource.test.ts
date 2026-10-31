import { describe, expect, it } from '@jest/globals';

import {
  citationResource,
  conversationResource,
  messageResource,
} from '@/domain/api/conversation-resource';

describe('citationResource', () => {
  it('links to the article page, with its title when known', () => {
    expect(citationResource(4, new Map([[4, 'Four']]))).toEqual({
      article_id: '4',
      title: 'Four',
      href: '/article/4',
    });
  });

  it('leaves the title out when unknown', () => {
    expect(citationResource(4)).toEqual({
      article_id: '4',
      href: '/article/4',
    });
  });
});

describe('messageResource', () => {
  it('shows a turn with string ids and an RFC 3339 time', () => {
    expect(
      messageResource({
        id: 2,
        role: 'assistant',
        content: 'A',
        citations: [4],
        created_at: '2026-11-01 10:00:00',
      }),
    ).toEqual({
      id: '2',
      role: 'assistant',
      content: 'A',
      citations: [{ article_id: '4', href: '/article/4' }],
      created_at: '2026-11-01T10:00:00Z',
    });
  });
});

describe('conversationResource', () => {
  it('shows the conversation with its turns', () => {
    expect(
      conversationResource({ id: 3, user_id: 7, created_at: null }, []),
    ).toEqual({ id: '3', messages: [] });
  });
});
