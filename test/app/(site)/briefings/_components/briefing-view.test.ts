import { describe, expect, it } from '@jest/globals';

import {
  STAGES,
  STAGE_MS,
  groupBySection,
  paragraphs,
  progressAt,
  sectionHeading,
  stageAt,
  writtenWith,
} from '@/app/(site)/briefings/_components/briefing-view';

describe('sectionHeading', () => {
  it('names a fixed section as the briefing prints it', () => {
    expect(sectionHeading('top_stories')).toBe('Top stories');
    expect(sectionHeading('infrequent')).toBe('From quieter sources');
  });

  it('numbers a custom section', () => {
    expect(sectionHeading('custom_2')).toBe('Your topic 2');
  });
});

describe('groupBySection', () => {
  const stories = [
    { id: 1, category: 'long_read' as const },
    { id: 2, category: 'top_stories' as const },
    { id: 3, category: 'long_read' as const },
  ];

  it('follows the briefing’s order, leaving empty sections out', () => {
    expect(
      groupBySection(stories, ['top_stories', 'infrequent', 'long_read']),
    ).toEqual([
      { category: 'top_stories', stories: [stories[1]] },
      { category: 'long_read', stories: [stories[0], stories[2]] },
    ]);
  });

  it('keeps a section the order does not name, after the rest', () => {
    expect(
      groupBySection(stories, ['top_stories']).map((g) => g.category),
    ).toEqual(['top_stories', 'long_read']);
  });
});

describe('paragraphs', () => {
  it('splits on blank lines', () => {
    expect(paragraphs('One.\n\n Two.\n')).toEqual(['One.', 'Two.']);
  });

  it('splits on lines when there are no blank ones', () => {
    expect(paragraphs('- a\n- b')).toEqual(['- a', '- b']);
  });

  it('is empty for no summary', () => {
    expect(paragraphs(null)).toEqual([]);
    expect(paragraphs('  ')).toEqual([]);
  });
});

describe('writtenWith', () => {
  it('names the model, tokens and time', () => {
    expect(
      writtenWith({
        model: '@cf/meta/llama-3.1-8b-instruct-fast',
        tokens: 1234,
        seconds: 3.26,
      }),
    ).toBe('Written by meta/llama-3.1-8b-instruct-fast · 1,234 tokens · 3.3s');
  });

  it('is empty when nothing is known', () => {
    expect(writtenWith({ model: null, tokens: null, seconds: null })).toBe('');
  });
});

describe('stageAt and progressAt', () => {
  it('moves one stage at a time and stays on the last', () => {
    expect(stageAt(0)).toBe(0);
    expect(stageAt(STAGE_MS)).toBe(1);
    expect(stageAt(STAGE_MS * 99)).toBe(STAGES.length - 1);
  });

  it('fills the bar but never to the end before the answer', () => {
    expect(progressAt(0)).toBe(0);
    expect(progressAt(STAGE_MS * 2)).toBe(50);
    expect(progressAt(STAGE_MS * 99)).toBe(95);
  });
});
