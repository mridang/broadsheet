import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { askArticle } from '@/app/(site)/article/[id]/_components/answer-requests';
import { ProblemError } from '@/components/api/problem-message';

afterEach(() => {
  jest.restoreAllMocks();
});

describe('askArticle', () => {
  it('posts the question and resolves with the answer', async () => {
    const reply = { question: 'Why?', answer: 'Because.', remaining: 3 };
    const spy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json(reply));
    await expect(askArticle(4, { question: 'Why?' })).resolves.toEqual(reply);
    expect(spy).toHaveBeenCalledWith('/api/articles/4/answers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'Why?' }),
    });
  });

  it('posts a preset by id with its history', async () => {
    const spy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({}));
    const history = [{ role: 'user' as const, content: 'Q' }];
    await askArticle(4, { question_id: 'bullets', history });
    expect(spy.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({ question_id: 'bullets', history }),
    );
  });

  it('throws the server’s words when refused', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ title: 'No', detail: 'Slow down.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/problem+json' },
      }),
    );
    await expect(askArticle(4, { question: 'Why?' })).rejects.toBeInstanceOf(
      ProblemError,
    );
  });
});
