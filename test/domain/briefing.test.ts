import { describe, expect, it, jest } from '@jest/globals';

import {
  BRIEFING_MODEL,
  BRIEFING_MODELS,
  allocate,
  composeBriefing,
  modelFor,
  sectionOn,
  sectionOrder,
  MIN_BRIEFED,
  PER_SOURCE,
  briefingScore,
  infrequentBoost,
  maxTokens,
  parseBriefedStories,
  sectionsOf,
  selectStories,
  systemPrompt,
  userPrompt,
  wordCount,
  writeBriefing,
  type Candidate,
  type Choice,
} from '@/domain/briefing';
import type { Article } from '@/domain/repository';

function article(over: Partial<Article>): Article {
  return {
    id: 1,
    source_id: 1,
    url: 'https://example.com/a',
    title: 'A',
    source: 'Example',
    image: '',
    favicon: '',
    summary: '',
    published_at: '',
    points: 0,
    body_text: null,
    edition: '2026-11-01',
    cluster_id: null,
    fetched_at: '',
    ...over,
  } as Article;
}

function candidate(over: Partial<Candidate> & { id?: number } = {}): Candidate {
  const { id = 1, ...rest } = over;
  return {
    article: article({ id, source_id: id, url: `https://example.com/${id}` }),
    liked: false,
    matches: [],
    read: false,
    coverage: 1,
    also: [],
    monthly: 100,
    followed_up: false,
    ...rest,
  };
}

const prefs = {
  briefing_story_count: 5,
  briefing_read_filter: 'unread' as const,
  briefing_length: 'medium' as const,
  briefing_style: 'bullets' as const,
};

const ids = (picks: readonly Choice[]) =>
  picks.map((p) => p.candidate.article.id);

describe('wordCount', () => {
  it('counts the body, else the summary', () => {
    expect(wordCount(article({ body_text: 'one two three' }))).toBe(3);
    expect(wordCount(article({ summary: 'one two' }))).toBe(2);
    expect(wordCount(article({}))).toBe(0);
  });
});

describe('infrequentBoost', () => {
  it('doubles a source that published nothing and fades out at 30', () => {
    expect(infrequentBoost(0)).toBe(2);
    expect(infrequentBoost(15)).toBe(1.5);
    expect(infrequentBoost(30)).toBe(1);
    expect(infrequentBoost(31)).toBe(1);
  });
});

describe('briefingScore', () => {
  it('ranks a like and wider coverage higher', () => {
    expect(briefingScore(candidate({ liked: true }))).toBeGreaterThan(
      briefingScore(candidate()),
    );
    expect(briefingScore(candidate({ coverage: 3 }))).toBeGreaterThan(
      briefingScore(candidate()),
    );
  });
});

describe('selectStories', () => {
  const five = [1, 2, 3, 4, 5].map((id) =>
    candidate({ id, article: article({ id, source_id: id, points: id }) }),
  );

  it('takes the best stories up to the count', () => {
    expect(
      ids(selectStories(five, { ...prefs, briefing_story_count: 3 })),
    ).toEqual([5, 4, 3]);
  });

  it('covers unread stories when enough are unread', () => {
    const picks = selectStories(
      [
        ...five.slice(0, 3),
        candidate({
          id: 9,
          read: true,
          article: article({ id: 9, source_id: 9, points: 999 }),
        }),
      ],
      prefs,
    );
    expect(ids(picks)).not.toContain(9);
  });

  it('lets read stories back in when too few are unread', () => {
    const picks = selectStories(
      [
        candidate({ id: 1 }),
        candidate({ id: 2, read: true }),
        candidate({ id: 3, read: true }),
      ],
      prefs,
    );
    expect(picks).toHaveLength(3);
  });

  it(`takes at most ${PER_SOURCE} stories from one source`, () => {
    const same = [1, 2, 3, 4, 5].map((id) =>
      candidate({ id, article: article({ id, source_id: 1 }) }),
    );
    expect(selectStories(same, prefs)).toHaveLength(PER_SOURCE);
  });

  it('covers only liked stories with the focus filter', () => {
    const picks = selectStories(
      [...five, ...[6, 7, 8].map((id) => candidate({ id, liked: true }))],
      { ...prefs, briefing_read_filter: 'focus' },
    );
    expect(ids(picks).toSorted()).toEqual([6, 7, 8]);
  });

  it(`writes nothing for fewer than ${MIN_BRIEFED} stories`, () => {
    expect(selectStories(five.slice(0, 2), prefs)).toEqual([]);
  });

  it('gives each pick the first category that fits', () => {
    const picks = selectStories(
      [
        candidate({
          id: 1,
          coverage: 3,
          article: article({ id: 1, cluster_id: 7, points: 90 }),
        }),
        candidate({
          id: 2,
          coverage: 2,
          article: article({ id: 2, source_id: 2, cluster_id: 7, points: 80 }),
        }),
        candidate({ id: 3, monthly: 4 }),
        candidate({ id: 4, followed_up: true }),
        candidate({ id: 5, liked: true }),
        candidate({
          id: 6,
          article: article({
            id: 6,
            source_id: 6,
            body_text: 'w '.repeat(900),
          }),
        }),
        candidate({ id: 7 }),
      ],
      { ...prefs, briefing_story_count: 10 },
    );
    const of = new Map(picks.map((p) => [p.candidate.article.id, p.category]));
    expect(of.get(1)).toBe('widely_covered');
    expect(of.get(2)).not.toBe('widely_covered');
    expect(of.get(3)).toBe('infrequent');
    expect(of.get(4)).toBe('follow_up');
    expect(of.get(5)).toBe('classifier_match');
    expect(of.get(6)).toBe('long_read');
    expect(of.get(7)).toBe('top_stories');
  });
});

const picks: Choice[] = [
  {
    candidate: candidate({
      id: 1,
      article: article({
        id: 1,
        title: 'Quake',
        summary: 'x'.repeat(400),
        source: 'BBC',
      }),
      matches: ['title: quake'],
      also: ['A', 'B', 'C', 'D', 'E', 'F'],
    }),
    category: 'widely_covered',
  },
  { candidate: candidate({ id: 2, read: true }), category: 'top_stories' },
];

describe('sectionsOf', () => {
  it('lists the sections in print order', () => {
    expect(sectionsOf([...picks].reverse())).toEqual([
      'top_stories',
      'widely_covered',
    ]);
  });
});

describe('systemPrompt', () => {
  it('names the sections in order with their guidance', () => {
    const text = systemPrompt(picks, prefs);
    expect(text).toContain('1. Top stories (top_stories)');
    expect(text).toContain('2. Widely covered (widely_covered)');
    expect(text).not.toContain('Long reads');
  });

  it.each([
    ['short', 'under 300 words'],
    ['medium', 'under 600 words'],
    ['detailed', 'up to 1000 words'],
  ] as const)('asks for the %s length', (briefing_length, wording) => {
    expect(systemPrompt(picks, { ...prefs, briefing_length })).toContain(
      wording,
    );
  });

  it.each([
    ['editorial', 'flowing prose'],
    ['bullets', 'starting with "• "'],
    ['headlines', 'just its headline'],
  ] as const)('asks for the %s style', (briefing_style, wording) => {
    expect(systemPrompt(picks, { ...prefs, briefing_style })).toContain(
      wording,
    );
  });

  it('asks for plain text only', () => {
    expect(systemPrompt(picks, prefs)).toContain('no HTML');
  });
});

describe('userPrompt', () => {
  const text = userPrompt(picks, '2026-11-01');

  it('starts with the date', () => {
    expect(text.startsWith("Today's date: 2026-11-01")).toBe(true);
  });

  it('describes each story', () => {
    expect(text).toContain('TITLE: Quake');
    expect(text).toContain('FEED: BBC');
    expect(text).toContain('CATEGORY: widely_covered');
    expect(text).toContain('READ_STATUS: read');
    expect(text).toContain('MATCHES: title: quake');
  });

  it('cuts the excerpt to 300 characters', () => {
    expect(text).toContain(`EXCERPT: ${'x'.repeat(300)}\n`);
  });

  it('names at most five other sources', () => {
    expect(text).toContain('CLUSTER: Also covered by: A, B, C, D, E\n');
  });
});

describe('maxTokens', () => {
  it('grows with stories and sections', () => {
    expect(maxTokens(picks)).toBe(1024 + 160 + 200);
  });

  it('stops at 4096', () => {
    expect(maxTokens(Array.from({ length: 60 }, () => picks[0]!))).toBe(4096);
  });
});

/** An env whose model answers with each of `answers` in turn. */
const envWith = (...answers: unknown[]) => {
  const run = jest.fn<(model: string, input: unknown) => Promise<unknown>>(
    async () => {
      const next = answers.shift();
      if (next instanceof Error) throw next;
      return { response: next };
    },
  );
  return { run, env: { AI: { run } } as unknown as CloudflareEnv };
};
const noWait = async () => undefined;

describe('writeBriefing', () => {
  it('sends the system and story prompts with the token budget', async () => {
    const { run, env } = envWith('  A big day. ');
    expect(await writeBriefing(env, picks, prefs, '2026-11-01', noWait)).toBe(
      'A big day.',
    );
    expect(run).toHaveBeenCalledWith(
      BRIEFING_MODEL,
      expect.objectContaining({ max_tokens: maxTokens(picks) }),
    );
  });

  it('asks nothing when there are no stories', async () => {
    const { run, env } = envWith('x');
    expect(
      await writeBriefing(env, [], prefs, '2026-11-01', noWait),
    ).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it('gives no note when the model answers with nothing', async () => {
    const { env } = envWith('');
    expect(
      await writeBriefing(env, picks, prefs, '2026-11-01', noWait),
    ).toBeNull();
  });

  it('tries again after a failure, waiting longer each time', async () => {
    const error = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const wait = jest.fn(noWait);
    const { run, env } = envWith(
      new Error('busy'),
      new Error('busy'),
      'Third time.',
    );
    expect(await writeBriefing(env, picks, prefs, '2026-11-01', wait)).toBe(
      'Third time.',
    );
    expect(run).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[4000], [8000]]);
    error.mockRestore();
  });

  it('logs each failure and gives up after three', async () => {
    const error = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { run, env } = envWith(
      new Error('a'),
      new Error('b'),
      new Error('c'),
    );
    expect(
      await writeBriefing(env, picks, prefs, '2026-11-01', noWait),
    ).toBeNull();
    expect(run).toHaveBeenCalledTimes(3);
    expect(String(error.mock.calls[2]?.[0])).toContain('briefing.failed');
    error.mockRestore();
  });
});

describe('parseBriefedStories', () => {
  it('reads back stored stories', () => {
    expect(parseBriefedStories('[{"id":1,"category":"long_read"}]')).toEqual([
      { id: 1, category: 'long_read' },
    ]);
  });

  it.each([
    null,
    '{',
    '{}',
    '[{"id":"1","category":"long_read"}]',
    '[{"id":1,"category":"x"}]',
  ])('reads nothing from %s', (stored) => {
    expect(parseBriefedStories(stored)).toEqual([]);
  });
});

describe('sectionOn', () => {
  const prefs = { briefing_sections: {}, briefing_prompts: [] };

  it('keeps top stories on even when turned off', () => {
    expect(
      sectionOn('top_stories', {
        ...prefs,
        briefing_sections: { top_stories: false },
      }),
    ).toBe(true);
  });

  it('turns a section off', () => {
    expect(
      sectionOn('long_read', {
        ...prefs,
        briefing_sections: { long_read: false },
      }),
    ).toBe(false);
    expect(sectionOn('long_read', prefs)).toBe(true);
  });

  it('turns a keyword section on only with its prompt', () => {
    expect(sectionOn('custom_1', prefs)).toBe(false);
    expect(
      sectionOn('custom_1', { ...prefs, briefing_prompts: ['rust'] }),
    ).toBe(true);
  });
});

describe('sectionOrder', () => {
  it('puts the reader’s order first and the rest after', () => {
    const order = sectionOrder({
      briefing_section_order: ['long_read', 'nope'],
    });
    expect(order[0]).toBe('long_read');
    expect(order).not.toContain('nope');
    expect(new Set(order).size).toBe(order.length);
  });
});

describe('allocate', () => {
  it('gives the first section most and the last the rest', () => {
    expect([
      ...allocate(10, ['top_stories', 'long_read', 'infrequent']),
    ]).toEqual([
      ['top_stories', 5],
      ['long_read', 3],
      ['infrequent', 2],
    ]);
  });

  it('gives each section at least one while the budget lasts', () => {
    expect([
      ...allocate(2, ['top_stories', 'long_read', 'infrequent']),
    ]).toEqual([
      ['top_stories', 1],
      ['long_read', 1],
      ['infrequent', 0],
    ]);
  });

  it('is empty with no sections', () => {
    expect(allocate(5, []).size).toBe(0);
  });
});

describe('selectStories with the reader’s settings', () => {
  const many = [1, 2, 3, 4, 5, 6].map((id) =>
    candidate({ id, article: article({ id, source_id: id, points: id }) }),
  );

  it('covers only stories from liked sources with the focus filter', () => {
    const picks = selectStories(
      [
        ...many,
        ...[7, 8, 9].map((id) => candidate({ id, source_liked: true })),
      ],
      { ...prefs, briefing_read_filter: 'focus' },
    );
    expect(ids(picks).toSorted()).toEqual([7, 8, 9]);
  });

  it('covers read stories when the reader includes them', () => {
    const read = candidate({
      id: 9,
      read: true,
      article: article({ id: 9, source_id: 9, points: 999 }),
    });
    expect(
      ids(
        selectStories([...many, read], {
          ...prefs,
          briefing_include_read: true,
        }),
      ),
    ).toContain(9);
  });

  it('files a story under top stories when its section is off', () => {
    const long = candidate({
      id: 9,
      article: article({
        id: 9,
        source_id: 9,
        points: 999,
        body_text: 'w '.repeat(900),
      }),
    });
    const picks = selectStories([...many, long], {
      ...prefs,
      briefing_sections: { long_read: false },
    });
    expect(picks.find((p) => p.candidate.article.id === 9)?.category).toBe(
      'top_stories',
    );
  });

  it('prints the sections in the reader’s order', () => {
    const long = candidate({
      id: 9,
      article: article({ id: 9, source_id: 9, body_text: 'w '.repeat(900) }),
    });
    const picks = selectStories([...many, long], {
      ...prefs,
      briefing_section_order: ['long_read', 'top_stories'],
    });
    expect(picks[0]?.category).toBe('long_read');
  });

  it('adds keyword stories beyond the budget, at most two a prompt', () => {
    const found = [20, 21, 22].map((id) => candidate({ id }));
    const picks = selectStories(
      many,
      { ...prefs, briefing_prompts: ['rust'] },
      new Map([['custom_1', found]]),
    );
    expect(picks.filter((p) => p.category === 'custom_1')).toHaveLength(2);
    expect(picks).toHaveLength(7);
  });

  it('leaves out a keyword section with no prompt', () => {
    const picks = selectStories(
      many,
      prefs,
      new Map([['custom_1', [candidate({ id: 20 })]]]),
    );
    expect(picks.some((p) => p.category === 'custom_1')).toBe(false);
  });

  it('adds up to three unread site-wide stories per section', () => {
    const everyone = [30, 31, 32, 33].map((id) => candidate({ id }));
    const picks = selectStories(
      many,
      prefs,
      new Map([
        ['widely_read', [...everyone, candidate({ id: 40, read: true })]],
      ]),
    );
    expect(ids(picks.filter((p) => p.category === 'widely_read'))).toEqual([
      30, 31, 32,
    ]);
  });

  it('turns off a site-wide section', () => {
    const picks = selectStories(
      many,
      { ...prefs, briefing_sections: { widely_read: false } },
      new Map([['widely_read', [candidate({ id: 30 })]]]),
    );
    expect(picks.some((p) => p.category === 'widely_read')).toBe(false);
  });

  it('never repeats a story another section covers', () => {
    const picks = selectStories(
      many,
      prefs,
      new Map([['widely_read', [many[5]!]]]),
    );
    expect(ids(picks).filter((id) => id === 6)).toHaveLength(1);
  });

  it('takes a lower minimum when given one', () => {
    expect(selectStories(many.slice(0, 1), prefs, new Map(), 1)).toHaveLength(
      1,
    );
  });
});

describe('systemPrompt for keyword sections', () => {
  it('asks for a heading written from the keywords', () => {
    const text = systemPrompt(
      [{ candidate: candidate(), category: 'custom_1' }],
      { ...prefs, briefing_prompts: ['rust compilers'] },
    );
    expect(text).toContain(
      'A heading you write from these keywords: rust compilers',
    );
  });
});

describe('modelFor', () => {
  it('takes a model we offer', () => {
    expect(modelFor(BRIEFING_MODELS[1])).toBe(BRIEFING_MODELS[1]);
  });

  it.each([null, undefined, '@cf/some/other'])('falls back for %s', (m) => {
    expect(modelFor(m)).toBe(BRIEFING_MODEL);
  });
});

describe('composeBriefing', () => {
  it('writes with the reader’s model and reports the tokens used', async () => {
    const run = jest.fn<
      (model: string) => Promise<{ response: string; usage: object }>
    >(async () => ({
      response: 'Note.',
      usage: { total_tokens: 321 },
    }));
    const env = { AI: { run } } as unknown as CloudflareEnv;
    const out = await composeBriefing(
      env,
      picks,
      { ...prefs, briefing_model: BRIEFING_MODELS[2] ?? null },
      '2026-11-01',
      noWait,
    );
    expect(out).toMatchObject({
      text: 'Note.',
      model: BRIEFING_MODELS[2],
      tokens: 321,
    });
    expect(run.mock.calls[0]?.[0]).toBe(BRIEFING_MODELS[2]);
  });

  it('reports no tokens when the model does not say', async () => {
    const { env } = envWith('Note.');
    expect(
      (await composeBriefing(env, picks, prefs, '2026-11-01', noWait)).tokens,
    ).toBeNull();
  });
});
