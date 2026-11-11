import { afterEach, describe, expect, it, jest } from '@jest/globals';

import {
  askArticle,
  transcribeAudio,
} from '@/app/(site)/article/[id]/_components/answer-requests';
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
      Response.json(
        { title: 'No', detail: 'Slow down.' },
        {
          status: 429,
          headers: { 'Content-Type': 'application/problem+json' },
        },
      ),
    );
    await expect(askArticle(4, { question: 'Why?' })).rejects.toBeInstanceOf(
      ProblemError,
    );
  });
});

describe('transcribeAudio', () => {
  it('posts the recording as audio and resolves with its text', async () => {
    const spy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ text: 'Hi' }));
    const audio = new Blob([new Uint8Array([1])], { type: 'audio/ogg' });
    await expect(transcribeAudio(audio)).resolves.toBe('Hi');
    expect(spy).toHaveBeenCalledWith('/api/transcriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'audio/ogg' },
      body: audio,
    });
  });

  it('throws the server’s words when refused', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        { title: 'No', detail: 'Too long.' },
        {
          status: 413,
          headers: { 'Content-Type': 'application/problem+json' },
        },
      ),
    );
    await expect(transcribeAudio(new Blob([]))).rejects.toBeInstanceOf(
      ProblemError,
    );
  });
});
