import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { askArticle } from '@/app/(site)/article/[id]/_components/answer-requests';
import { ProblemError } from '@/components/api/problem-message';

afterEach(() => {
  jest.restoreAllMocks();
});

describe('askArticle', () => {
  it('posts the question and resolves with the answer', async () => {
    const spy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ answer: 'Because.' }));
    await expect(askArticle(4, 'Why?')).resolves.toBe('Because.');
    expect(spy).toHaveBeenCalledWith('/api/articles/4/answers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'Why?' }),
    });
  });

  it('throws the server’s words when refused', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ title: 'No', detail: 'Slow down.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/problem+json' },
      }),
    );
    await expect(askArticle(4, 'Why?')).rejects.toBeInstanceOf(ProblemError);
  });
});
