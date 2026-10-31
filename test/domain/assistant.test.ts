import { describe, expect, it, jest } from '@jest/globals';

import {
  ANSWER_MODEL,
  AnswerUnavailable,
  MAX_QUESTION_LENGTH,
  PRESET_QUESTIONS,
  archivePrompt,
  articlePrompt,
  citedIds,
  complete,
  parseQuestion,
  type AnswerModel,
} from '@/domain/assistant';
import type { Message, Passage } from '@/domain/repository';

const passage = (id: number, title = `T${id}`): Passage => ({
  id,
  title,
  source: 's',
  summary: null,
  text: 'body',
});

const turn = (id: number, role: Message['role']): Message => ({
  id,
  role,
  content: `turn ${id}`,
  citations: [],
  created_at: null,
});

describe('PRESET_QUESTIONS', () => {
  it('offers summarise, explain and the other side', () => {
    expect(PRESET_QUESTIONS.map((p) => p.label)).toEqual([
      'Summarise',
      'Explain',
      'The other side',
    ]);
  });
});

describe('parseQuestion', () => {
  it('accepts a question, trimmed', () => {
    expect(parseQuestion({ question: '  why? ' }, 'question')).toEqual({
      ok: true,
      question: 'why?',
    });
  });

  it('reads the member it is told to', () => {
    expect(parseQuestion({ content: 'hi' }, 'content')).toEqual({
      ok: true,
      question: 'hi',
    });
  });

  it.each([
    [{}, 'question: must be a string.'],
    [{ question: 3 }, 'question: must be a string.'],
    [{ question: '  ' }, 'question: must not be blank.'],
    [
      { question: 'x'.repeat(MAX_QUESTION_LENGTH + 1) },
      `question: at most ${MAX_QUESTION_LENGTH} characters.`,
    ],
    [{ question: 'a', extra: 1 }, 'extra: not a member of this request.'],
  ])('refuses %j', (body, error) => {
    expect(parseQuestion(body, 'question')).toEqual({
      ok: false,
      errors: [error],
    });
  });
});

describe('articlePrompt', () => {
  it('grounds the question in the story text', () => {
    const [system, user] = articlePrompt(
      { title: 'Title', summary: 'sum', body_text: 'The text.' },
      'Q?',
    );
    expect(system?.content).toContain('Title: Title');
    expect(system?.content).toContain('The text.');
    expect(user).toEqual({ role: 'user', content: 'Q?' });
  });

  it('falls back to the summary when no text was kept', () => {
    const [system] = articlePrompt(
      { title: 'T', summary: 'only sum', body_text: null },
      'Q',
    );
    expect(system?.content).toContain('only sum');
  });
});

describe('archivePrompt', () => {
  it('numbers the passages for citing', () => {
    const [system] = archivePrompt([passage(5), passage(9)], [], 'Q');
    expect(system?.content).toContain('[1] T5');
    expect(system?.content).toContain('[2] T9');
  });

  it('says when nothing matched', () => {
    expect(archivePrompt([], [], 'Q')[0]?.content).toContain(
      '(no stories matched)',
    );
  });

  it('sends only the last six turns, then the question', () => {
    const history = Array.from({ length: 8 }, (_, i) =>
      turn(i + 1, i % 2 ? 'assistant' : 'user'),
    );
    const prompt = archivePrompt([], history, 'Q');
    expect(prompt).toHaveLength(8);
    expect(prompt[1]?.content).toBe('turn 3');
    expect(prompt.at(-1)).toEqual({ role: 'user', content: 'Q' });
  });
});

describe('citedIds', () => {
  it('maps [n] to the passages’ ids in the order first cited, once each', () => {
    expect(
      citedIds('See [2] and [1], again [2].', [passage(5), passage(9)]),
    ).toEqual([9, 5]);
  });

  it('ignores numbers that name no passage', () => {
    expect(citedIds('[0] [3]', [passage(5)])).toEqual([]);
  });
});

describe('complete', () => {
  const model = (reply: unknown): AnswerModel => ({
    run: jest.fn(async () => reply),
  });

  it('answers with the model’s text, trimmed', async () => {
    const ai = model({ response: ' An answer. ' });
    await expect(complete(ai, [])).resolves.toBe('An answer.');
    expect(ai.run).toHaveBeenCalledWith(ANSWER_MODEL, { messages: [] });
  });

  it('is unavailable with no model bound', async () => {
    await expect(complete(undefined, [])).rejects.toBeInstanceOf(
      AnswerUnavailable,
    );
  });

  it.each([{}, { response: '  ' }, null])(
    'is unavailable when the model gives %j',
    async (reply) => {
      await expect(complete(model(reply), [])).rejects.toBeInstanceOf(
        AnswerUnavailable,
      );
    },
  );

  it('is unavailable when the model throws', async () => {
    const ai: AnswerModel = {
      run: async () => {
        throw new Error('down');
      },
    };
    await expect(complete(ai, [])).rejects.toThrow('down');
  });
});
