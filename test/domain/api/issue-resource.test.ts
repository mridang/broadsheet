import { describe, expect, it } from '@jest/globals';

import {
  issueResource,
  issueSummaryResource,
  parseIssueQuery,
  parseIssueRequest,
} from '@/domain/api/issue-resource';
import { encodeCursor } from '@/lib/core/api';

const layout = {
  groups: [
    {
      name: null,
      desks: [
        {
          feed_id: 3,
          title: 'HN',
          url: 'https://hn.test/rss',
          stories: [
            {
              id: 7,
              tier: 'lead' as const,
              also: ['BBC'],
              siblings: [
                {
                  id: 8,
                  source: 'BBC',
                  url: 'https://bbc.test/8',
                  tier: 'title' as const,
                },
              ],
            },
          ],
        },
      ],
    },
    { name: 'Tech', desks: [] },
  ],
};

describe('issueResource', () => {
  it('shows ids as strings and names the other coverage', () => {
    expect(
      issueResource({
        date: '2026-11-01',
        layout,
        briefing: 'Big day.',
        briefing_stories: [{ id: 7, category: 'widely_covered' }],
        created_at: '2026-11-01 06:10:00',
      }),
    ).toEqual({
      date: '2026-11-01',
      briefing: 'Big day.',
      briefing_stories: [{ article_id: '7', category: 'widely_covered' }],
      sections: [
        {
          desks: [
            {
              feed_id: '3',
              title: 'HN',
              url: 'https://hn.test/rss',
              stories: [
                {
                  article_id: '7',
                  tier: 'lead',
                  also_covered_by: ['BBC'],
                  covered_by: [
                    {
                      article_id: '8',
                      source: 'BBC',
                      url: 'https://bbc.test/8',
                      match: 'title',
                      read: false,
                      score: 0,
                    },
                  ],
                },
              ],
            },
          ],
        },
        { name: 'Tech', desks: [] },
      ],
      created_at: '2026-11-01T06:10:00.000Z',
    });
  });

  it('leaves out a missing note and time', () => {
    const out = issueResource({
      date: '2026-11-01',
      layout,
      briefing: null,
      briefing_stories: [],
      created_at: null,
    });
    expect(out).not.toHaveProperty('briefing');
    expect(out).not.toHaveProperty('created_at');
  });
});

describe('issueResource of an older stored layout', () => {
  it('shows no copies for a story stored before copies were kept', () => {
    const out = issueResource({
      date: '2026-11-01',
      layout: {
        groups: [
          {
            name: null,
            desks: [
              {
                feed_id: 1,
                title: 't',
                url: 'u',
                stories: [{ id: 1, tier: 'lead', also: [] }],
              },
            ],
          },
        ],
      },
      briefing: null,
      briefing_stories: [],
      created_at: null,
    });
    expect(out.sections[0]?.desks[0]?.stories[0]?.covered_by).toEqual([]);
  });
});

describe('issueSummaryResource', () => {
  it('shows the date, note and time', () => {
    expect(
      issueSummaryResource({
        date: '2026-11-01',
        briefing: 'Note.',
        created_at: '2026-11-01 06:10:00',
      }),
    ).toEqual({
      date: '2026-11-01',
      briefing: 'Note.',
      created_at: '2026-11-01T06:10:00.000Z',
    });
  });

  it('leaves out what is missing', () => {
    expect(
      issueSummaryResource({
        date: '2026-11-01',
        briefing: null,
        created_at: 'x',
      }),
    ).toEqual({ date: '2026-11-01' });
  });
});

describe('parseIssueRequest', () => {
  it('accepts a date', () => {
    expect(parseIssueRequest({ date: '2026-11-01' })).toEqual({
      ok: true,
      date: '2026-11-01',
    });
  });

  it.each([
    [{}, 'date: must be a date written YYYY-MM-DD.'],
    [{ date: '2026-02-30' }, 'date: must be a date written YYYY-MM-DD.'],
    [{ date: 5 }, 'date: must be a date written YYYY-MM-DD.'],
    [
      { date: '2026-11-01', layout: 1 },
      'layout: not a member of an issue request.',
    ],
  ])('refuses %j', (body, error) => {
    const out = parseIssueRequest(body);
    expect(out.ok).toBe(false);
    expect(out.ok ? [] : out.errors).toContain(error);
  });
});

describe('parseIssueQuery', () => {
  it('defaults the limit', () => {
    expect(parseIssueQuery(new URLSearchParams())).toEqual({
      ok: true,
      query: { limit: 20 },
    });
  });

  it('reads a cursor this API issued', () => {
    const cursor = encodeCursor({ key: '2026-10-30', id: '2026-10-30' });
    expect(
      parseIssueQuery(new URLSearchParams({ cursor, limit: '5' })),
    ).toEqual({ ok: true, query: { before: '2026-10-30', limit: 5 } });
  });

  it.each([
    ['cursor=nope', 'cursor: not a cursor of this list.'],
    ['limit=0', 'limit: must be a whole number from 1 to 100.'],
    ['limit=1.5', 'limit: must be a whole number from 1 to 100.'],
    ['q=x', 'q: not a parameter of this list.'],
  ])('refuses %s', (query, error) => {
    const out = parseIssueQuery(new URLSearchParams(query));
    expect(out.ok ? [] : out.errors).toContain(error);
  });
});
