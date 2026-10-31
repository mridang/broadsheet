import { describe, expect, it } from '@jest/globals';

import { issueResource } from '@/domain/api/issue-resource';

const layout = {
  groups: [
    {
      name: null,
      desks: [
        {
          feed_id: 3,
          title: 'HN',
          url: 'https://hn.test/rss',
          stories: [{ id: 7, tier: 'lead' as const, also: ['BBC'] }],
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
        created_at: '2026-11-01 06:10:00',
      }),
    ).toEqual({
      date: '2026-11-01',
      briefing: 'Big day.',
      sections: [
        {
          desks: [
            {
              feed_id: '3',
              title: 'HN',
              url: 'https://hn.test/rss',
              stories: [
                { article_id: '7', tier: 'lead', also_covered_by: ['BBC'] },
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
      created_at: null,
    });
    expect(out).not.toHaveProperty('briefing');
    expect(out).not.toHaveProperty('created_at');
  });
});
