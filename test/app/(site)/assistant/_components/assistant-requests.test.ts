import { afterEach, describe, expect, it, jest } from '@jest/globals';

import {
  deleteConversation,
  sendMessage,
  startConversation,
} from '@/app/(site)/assistant/_components/assistant-requests';
import { ProblemError } from '@/components/api/problem-message';

afterEach(() => {
  jest.restoreAllMocks();
});

describe('startConversation', () => {
  it('posts to the conversations collection and resolves with the id', async () => {
    const spy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ id: '3', messages: [] }));
    await expect(startConversation()).resolves.toBe('3');
    expect(spy).toHaveBeenCalledWith('/api/conversations', { method: 'POST' });
  });
});

describe('sendMessage', () => {
  it('posts the question and resolves with the answer', async () => {
    const turn = { id: '9', role: 'assistant', content: 'A', citations: [] };
    const spy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json(turn));
    await expect(sendMessage('3', 'Q')).resolves.toEqual(turn);
    expect(spy).toHaveBeenCalledWith('/api/conversations/3/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Q' }),
    });
  });

  it('throws the server’s words when refused', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        { title: 'No', detail: 'Down.' },
        {
          status: 502,
          headers: { 'Content-Type': 'application/problem+json' },
        },
      ),
    );
    await expect(sendMessage('3', 'Q')).rejects.toBeInstanceOf(ProblemError);
  });
});

describe('deleteConversation', () => {
  it('deletes the conversation', async () => {
    const spy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));
    await deleteConversation('3');
    expect(spy).toHaveBeenCalledWith('/api/conversations/3', {
      method: 'DELETE',
    });
  });

  it('throws the server’s words when refused', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        { title: 'No', detail: 'Gone.' },
        {
          status: 404,
          headers: { 'Content-Type': 'application/problem+json' },
        },
      ),
    );
    await expect(deleteConversation('3')).rejects.toBeInstanceOf(ProblemError);
  });
});
