import { describe, expect, it } from '@jest/globals';

import {
  briefingResource,
  parseBriefingQuery,
} from '@/domain/api/briefing-resource';
import type { Article, StoredBriefing } from '@/domain/repository';
import { encodeCursor } from '@/lib/core/api';

const stored: StoredBriefing = {
  id: 4,
  user_id: 7,
  slot: 'morning',
  local_date: '2026-11-01',
  frequency: 'daily',
  period_start: '2026-10-31T08:30:00.000Z',
  title: 'Morning Daily Briefing — Sunday, November 1, 2026',
  summary: 'Note.',
  stories: '[{"id":1,"category":"top_stories"},{"id":2,"category":"custom_1"}]',
  sections: '["top_stories","custom_1","nope"]',
  status: 'complete',
  error: null,
  model: '@cf/meta/llama-3.1-8b-instruct-fast',
  tokens: 120,
  seconds: 1.5,
  created_at: '2026-11-01 08:25:00',
};

describe('briefingResource', () => {
  it('shows each story with its article and whether it was read', () => {
    const articles = new Map([
      [
        1,
        { id: 1, title: 'One', url: 'https://x.test/1', source: '' } as Article,
      ],
    ]);
    expect(briefingResource(stored, articles, new Set([1]))).toEqual({
      id: '4',
      title: stored.title,
      slot: 'morning',
      local_date: '2026-11-01',
      frequency: 'daily',
      period_start: '2026-10-31T08:30:00.000Z',
      status: 'complete',
      summary: 'Note.',
      sections: ['top_stories', 'custom_1'],
      stories: [
        {
          article_id: '1',
          category: 'top_stories',
          title: 'One',
          url: 'https://x.test/1',
          source: 'x.test',
          read: true,
        },
        { article_id: '2', category: 'custom_1', read: false },
      ],
      model: '@cf/meta/llama-3.1-8b-instruct-fast',
      tokens: 120,
      seconds: 1.5,
      created_at: '2026-11-01T08:25:00.000Z',
    });
  });

  it('shows a failed briefing with its error and no cost', () => {
    const out = briefingResource({
      ...stored,
      status: 'failed',
      summary: null,
      error: 'Summary generation failed.',
      tokens: null,
      seconds: null,
      sections: '{',
    });
    expect(out).toMatchObject({
      status: 'failed',
      error: 'Summary generation failed.',
      sections: [],
    });
    expect(out).not.toHaveProperty('summary');
    expect(out).not.toHaveProperty('tokens');
  });
});

describe('parseBriefingQuery', () => {
  it('defaults the limit and reads a cursor', () => {
    expect(parseBriefingQuery(new URLSearchParams())).toEqual({
      ok: true,
      query: { limit: 20 },
    });
    const cursor = encodeCursor({ key: '9', id: '9' });
    expect(parseBriefingQuery(new URLSearchParams({ cursor }))).toMatchObject({
      ok: true,
      query: { before: 9 },
    });
  });

  it.each([
    ['cursor=x', 'cursor: not a cursor of this list.'],
    ['limit=101', 'limit: must be a whole number from 1 to 100.'],
    ['q=1', 'q: not a parameter of this list.'],
  ])('refuses %s', (q, error) => {
    const out = parseBriefingQuery(new URLSearchParams(q));
    expect(out.ok ? [] : out.errors).toContain(error);
  });
});
